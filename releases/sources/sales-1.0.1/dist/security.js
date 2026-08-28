export function salesExportObjectKey(filename) {
  if (typeof filename !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u.test(filename) || filename === "." || filename === "..") {
    throw new TypeError("Sales export filename must be a bounded basename.");
  }
  return `sales/${filename}`;
}
