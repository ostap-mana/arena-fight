import bpy
import bmesh
import sys
import math
from mathutils import Vector, Quaternion, Matrix

argv = sys.argv[sys.argv.index("--") + 1:]
path, out, side, mode = argv[0], argv[1], argv[2], argv[3]
CURL = float(argv[4]) if len(argv) > 4 else 1.25
KEEP = argv[5].split(",") if len(argv) > 5 else ["Wrist", "ElbowRoll"]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=path)
scene = bpy.context.scene

arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
meshes = [o for o in bpy.data.objects if o.type == "MESH" and not o.name.startswith("Icosphere")]
for o in bpy.data.objects:
    if o.name.startswith("Icosphere"):
        bpy.data.objects.remove(o)

idle = bpy.data.actions.get("IdleLOB")
arm.animation_data_create()
arm.animation_data.action = idle
if hasattr(arm.animation_data, "action_slot") and idle.slots:
    arm.animation_data.action_slot = idle.slots[0]
scene.frame_set(1)

pose = {}
for pb in arm.pose.bones:
    pb.rotation_mode = "QUATERNION"
    pose[pb.name] = (pb.location.copy(), pb.rotation_quaternion.copy(), pb.scale.copy())
arm.animation_data.action = None
for pb in arm.pose.bones:
    loc, rot, scl = pose[pb.name]
    pb.location, pb.rotation_quaternion, pb.scale = loc, rot, scl

fingers = ["Index", "Middle", "Ring", "Pinky", "Thumb"]
for f in fingers:
    for j in (1, 2, 3):
        pb = arm.pose.bones.get(f"{f}Finger{j}_{side}")
        if not pb:
            continue
        if f == "Index":
            pb.rotation_quaternion = Quaternion()
        elif f != "Thumb":
            q = pb.rotation_quaternion
            axis, ang = q.to_axis_angle()
            pb.rotation_quaternion = Quaternion(axis, ang * CURL)
bpy.context.view_layer.update()

hand_groups = {f"{k}_{side}" for k in KEEP} | {f"{f}Finger{j}_{side}" for f in fingers for j in (1, 2, 3)}
keep_objs = []
for ob in meshes:
    idx = {g.index for g in ob.vertex_groups if g.name in hand_groups}
    if not idx:
        bpy.data.objects.remove(ob)
        continue
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    deform = bm.verts.layers.deform.active
    kill = []
    for v in bm.verts:
        w = sum(val for gi, val in v[deform].items() if gi in idx) if deform else 0
        if w < 0.5:
            kill.append(v)
    bmesh.ops.delete(bm, geom=kill, context="VERTS")
    bm.to_mesh(ob.data)
    bm.free()
    if len(ob.data.vertices) == 0:
        bpy.data.objects.remove(ob)
    else:
        keep_objs.append(ob)
bpy.context.view_layer.update()

dg = bpy.context.evaluated_depsgraph_get()
pts = []
for ob in keep_objs:
    ev = ob.evaluated_get(dg)
    me = ev.to_mesh()
    pts += [ev.matrix_world @ v.co for v in me.vertices]
    ev.to_mesh_clear()
lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
center = (lo + hi) / 2
size = (hi - lo).length
print("KEPT", [(o.name, len(o.data.vertices)) for o in keep_objs], "SIZE", round(size, 3))

def wpos(name, tail=False):
    pb = arm.pose.bones[name]
    return arm.matrix_world @ (pb.tail if tail else pb.head)

wrist = wpos(f"Wrist_{side}")
tip = wpos(f"IndexFinger3_{side}", True)
pointing = (tip - wrist).normalized()
lateral = (wpos(f"IndexFinger1_{side}") - wpos(f"PinkyFinger1_{side}")).normalized()
normal = pointing.cross(lateral).normalized()
print("TIP", tuple(round(v, 4) for v in tip), "POINT", tuple(round(v, 3) for v in pointing), "NORMAL", tuple(round(v, 3) for v in normal))

scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 360
scene.render.resolution_y = 360
scene.render.film_transparent = True
scene.view_settings.view_transform = "Standard"
world = bpy.data.worlds.new("w")
world.use_nodes = True
bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
bg.inputs[1].default_value = 1.0
scene.world = world
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
sun.data.energy = 3
scene.collection.objects.link(sun)

cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
cam.data.type = "ORTHO"
cam.data.ortho_scale = size * 1.15
scene.collection.objects.link(cam)
scene.camera = cam

if mode == "views":
    for i in range(8):
        a = i * math.tau / 8
        d = (normal * math.cos(a) + lateral * math.sin(a)).normalized()
        cam.location = center + d * size * 4
        cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
        sun.rotation_euler = (-(d + Vector((0, 0, 1)))).to_track_quat("-Z", "Y").to_euler()
        up = pointing - d * pointing.dot(d)
        m = Matrix((d.cross(up).normalized() * -1, up.normalized(), d)).transposed()
        cam.matrix_world = Matrix.Translation(center + d * size * 4) @ m.to_4x4()
        scene.render.filepath = f"{out}_{i}.png"
        bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=out + ".blend")
