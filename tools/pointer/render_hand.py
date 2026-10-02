import bpy
import sys
import math
import json
from mathutils import Vector, Matrix
from bpy_extras.object_utils import world_to_camera_view

argv = sys.argv[sys.argv.index("--") + 1:]
out = argv[0]
views = json.loads(argv[1])
res = int(argv[2]) if len(argv) > 2 else 480
samples = int(argv[3]) if len(argv) > 3 else 32
side = "R"

scene = bpy.context.scene
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
hand = next(o for o in bpy.data.objects if o.type == "MESH")
for o in list(bpy.data.objects):
    if o.type in ("LIGHT", "CAMERA"):
        bpy.data.objects.remove(o)


def wpos(name, tail=False):
    pb = arm.pose.bones[name]
    return arm.matrix_world @ (pb.tail if tail else pb.head)


wrist = wpos(f"Wrist_{side}")
pointing = (wpos(f"IndexFinger3_{side}", True) - wrist).normalized()
lateral = (wpos(f"IndexFinger1_{side}") - wpos(f"PinkyFinger1_{side}")).normalized()
normal = pointing.cross(lateral).normalized()
lateral = normal.cross(pointing).normalized()

dg = bpy.context.evaluated_depsgraph_get()
ev = hand.evaluated_get(dg)
me = ev.to_mesh()
index_groups = {g.index for g in hand.vertex_groups if g.name.startswith("IndexFinger3")}
pts = []
tip = None
best = -1e9
for v in me.vertices:
    p = ev.matrix_world @ v.co
    pts.append(p)
for v in hand.data.vertices:
    if any(g.group in index_groups and g.weight > 0.5 for g in v.groups):
        p = ev.matrix_world @ me.vertices[v.index].co
        s = p.dot(pointing)
        if s > best:
            best, tip = s, p
ev.to_mesh_clear()
lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
center = (lo + hi) / 2
size = (hi - lo).length
finger_len = (tip - wpos(f"IndexFinger1_{side}")).length
contact = tip - pointing * finger_len * 0.12

for mat in hand.data.materials:
    if not mat or not mat.use_nodes:
        continue
    nt = mat.node_tree
    bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if not bsdf:
        continue
    link = bsdf.inputs["Base Color"].links
    if not link:
        continue
    tex = link[0].from_node
    bsdf.inputs["Roughness"].default_value = 0.5
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(tex.outputs["Color"], sep.inputs[0])
    diff = nt.nodes.new("ShaderNodeMath")
    diff.operation = "SUBTRACT"
    nt.links.new(sep.outputs[0], diff.inputs[0])
    nt.links.new(sep.outputs[1], diff.inputs[1])
    ramp = nt.nodes.new("ShaderNodeMapRange")
    ramp.inputs["From Min"].default_value = 0.22
    ramp.inputs["From Max"].default_value = 0.45
    ramp.inputs["To Min"].default_value = 0.0
    ramp.inputs["To Max"].default_value = 0.9
    nt.links.new(diff.outputs[0], ramp.inputs["Value"])
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Emission Color"])
    nt.links.new(ramp.outputs["Result"], bsdf.inputs["Emission Strength"])
    output = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    inner = nt.nodes.new("ShaderNodeBsdfDiffuse")
    inner.inputs["Color"].default_value = (0.02, 0.012, 0.018, 1)
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(geo.outputs["Backfacing"], mix.inputs[0])
    nt.links.new(bsdf.outputs[0], mix.inputs[1])
    nt.links.new(inner.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], output.inputs["Surface"])

scene.render.engine = "CYCLES"
scene.cycles.samples = samples
scene.cycles.use_denoising = True
scene.render.resolution_x = res
scene.render.resolution_y = res
scene.render.film_transparent = True
scene.view_settings.view_transform = "Standard"
scene.view_settings.look = "None"

world = bpy.data.worlds.new("w")
world.use_nodes = True
bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
bg.inputs[0].default_value = (0.35, 0.33, 0.42, 1)
bg.inputs[1].default_value = 0.25
scene.world = world


def area(name, energy, color, pos, size_k):
    d = bpy.data.lights.new(name, "AREA")
    d.energy = energy
    d.color = color
    d.size = size * size_k
    o = bpy.data.objects.new(name, d)
    scene.collection.objects.link(o)
    o.location = pos
    o.rotation_euler = (center - pos).to_track_quat("-Z", "Y").to_euler()
    return o


cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
cam.data.type = "ORTHO"
cam.data.ortho_scale = size * 1.05
scene.collection.objects.link(cam)
scene.camera = cam

meta = []
for i, v in enumerate(views):
    a = math.radians(v["az"])
    e = math.radians(v.get("el", 0))
    roll = math.radians(v.get("roll", 0))
    d = normal * math.cos(a) + lateral * math.sin(a)
    d = (d * math.cos(e) - pointing * math.sin(e)).normalized()
    up = (pointing - d * pointing.dot(d)).normalized()
    right = up.cross(d).normalized()
    up_r = (up * math.cos(roll) - right * math.sin(roll)).normalized()
    right_r = up_r.cross(d).normalized()
    m = Matrix((right_r, up_r, d)).transposed().to_4x4()
    m.translation = center + d * size * 4
    cam.matrix_world = m
    for o in [o for o in bpy.data.objects if o.type == "LIGHT"]:
        bpy.data.objects.remove(o)
    key_dir = (d + up_r * 0.9 + right_r * v.get("key", -0.7)).normalized()
    rim_dir = (-d + up_r * 0.5 + right_r * 0.9).normalized()
    rim2_dir = (-d - up_r * 0.3 - right_r * 0.9).normalized()
    fill_dir = (d - up_r * 0.6 + right_r * 0.8).normalized()
    area("key", v.get("keyE", 260) * size * size, (1.0, 0.86, 0.7), center + key_dir * size * 2.5, 1.2)
    area("rim", 200 * size * size, (0.6, 0.85, 1.0), center + rim_dir * size * 2.5, 0.6)
    area("rim2", 220 * size * size, (1.0, 0.55, 0.25), center + rim2_dir * size * 2.5, 0.6)
    area("fill", 70 * size * size, (0.7, 0.75, 1.0), center + fill_dir * size * 2.5, 1.5)
    scene.render.filepath = f"{out}_{i}.png"
    bpy.ops.render.render(write_still=True)
    tip_uv = world_to_camera_view(scene, cam, tip)
    con_uv = world_to_camera_view(scene, cam, contact)
    meta.append({"view": v, "tip": [tip_uv.x, 1 - tip_uv.y], "contact": [con_uv.x, 1 - con_uv.y]})
with open(out + "_meta.json", "w") as fh:
    json.dump(meta, fh, indent=1)
print("META", json.dumps(meta))
