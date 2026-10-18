/** A success entry cannot override another response status requiring login,
 * verification or retry. Check every status before accepting product facts. */
export function alibabaMobileResponseSucceeded(statuses: unknown): boolean {
  if (!Array.isArray(statuses) || !statuses.length) return false;
  for (const status of statuses) {
    if (typeof status !== 'string' || !/^SUCCESS(?:::|$)/.test(status)) return false;
  }
  return true;
}
