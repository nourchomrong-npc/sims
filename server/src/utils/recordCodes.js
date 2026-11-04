const prefixes = {
  students: 'STU',
  teachers: 'TCH',
  subjects: 'SUB'
};

export function generateRecordCode(entity, id) {
  const prefix = prefixes[entity];
  if (!prefix) throw new Error(`Unsupported record code entity: ${entity}`);
  if (!Number.isSafeInteger(Number(id)) || Number(id) < 1) {
    throw new Error(`Cannot generate a ${entity} code without a valid record ID`);
  }
  return `${prefix}-${String(id).padStart(6, '0')}`;
}
