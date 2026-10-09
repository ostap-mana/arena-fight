export function removeAt(list, index) {
  for (let i = index + 1; i < list.length; i++) list[i - 1] = list[i]
  list.pop()
}
