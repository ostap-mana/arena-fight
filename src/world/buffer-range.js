function keepRange() {}

export function markRange(attribute, count) {
  let range = attribute.liveRange
  if (!range) {
    range = attribute.liveRange = { start: 0, count: 0 }
    attribute.updateRanges = [range]
    attribute.clearUpdateRanges = keepRange
  }
  range.count = count
  attribute.needsUpdate = true
}
