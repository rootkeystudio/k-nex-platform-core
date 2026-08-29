export function salesExportObjectKey(filename) {
  if (typeof filename !== "string" || filename.length === 0) throw new TypeError("Sales export filename is required.");
  return `sales/${filename}`;
}
