function sortRecord(record) {
  if (record === undefined) return record;
  return Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right)));
}

module.exports = {
  hooks: {
    beforePacking(pkg) {
      for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
        pkg[field] = sortRecord(pkg[field]);
      }
      return pkg;
    }
  }
};
