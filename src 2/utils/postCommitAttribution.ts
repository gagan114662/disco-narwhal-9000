/**
 * Post-commit attribution hook installer.
 *
 * Stub re-created after the original was lost. The single consumer
 * (utils/worktree.ts:606) gates this behind `feature('COMMIT_ATTRIBUTION')`
 * AND awaits via dynamic import with `.catch()` on both the import and the
 * call, so a no-op shim is safe — the only effect is that worktrees won't
 * get the prepare-commit-msg hook installed automatically. If
 * COMMIT_ATTRIBUTION needs to actually attribute commits, restore the
 * original implementation from git history.
 */

export async function installPrepareCommitMsgHook(
  _worktreePath: string,
  _worktreeHooksDir: string | undefined,
): Promise<void> {
  // no-op — see file header
}
