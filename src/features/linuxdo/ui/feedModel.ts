export async function retryAfterVerification(
  verify: () => Promise<boolean>,
  reload: () => Promise<void>,
): Promise<boolean> {
  const verified = await verify()
  if (!verified) return false
  await reload()
  return true
}
