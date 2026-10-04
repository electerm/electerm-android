/**
 * Repo-relative paths that are removed from the vendored `src/` after the
 * upstream tree has been extracted and the `build/replace` overlay applied.
 *
 * `build/replace` can only add or overwrite files, so anything upstream ships
 * that Android must not have belongs here instead.
 *
 * Rules for entries:
 *   - one path per entry, relative to the repo root, POSIX separators
 *   - keep the reason next to the entry
 *   - revisit on every upstream bump: if upstream removes the file itself the
 *     entry becomes a no-op and should be deleted
 */

export default [
  // Upstream ships an SSH-server widget (a local SSH daemon the web UI can
  // start). Android does not expose it: the static widget registry in
  // src/app/widgets/load-widget.js omits it, so the module is unreachable, and
  // dropping the file keeps it out of the tree entirely.
  'src/app/widgets/widget-ssh-server.js'
]
