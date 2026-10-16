export interface CommitInfo {
  hash: string;
  /** Parent hashes, first parent first. Empty for root commits. */
  parents: string[];
  authorName: string;
  authorEmail: string;
  /** Author date, in seconds since the epoch. */
  authorDate: number;
  subject: string;
  /** Message body after the subject, without trailing whitespace. */
  body: string;
}

/**
 * `git log -z --format=<LOG_FORMAT>` prints seven NUL-separated fields per
 * commit, and `-z` ends each commit with another NUL. Messages cannot
 * contain NUL, so splitting on it is unambiguous.
 */
export const LOG_FORMAT = '%H%x00%P%x00%aN%x00%aE%x00%at%x00%s%x00%b';
const FIELDS = 7;

export function parseLog(output: string): CommitInfo[] {
  const tokens = output.split('\0');
  const commits: CommitInfo[] = [];
  for (let i = 0; i + FIELDS <= tokens.length; i += FIELDS) {
    // A record's first field may start with the newline git prints between
    // records in some modes; hashes never contain whitespace.
    const hash = tokens[i].trim();
    if (!hash) {
      break;
    }
    const [, parents, authorName, authorEmail, authorDate, subject, body] = tokens.slice(i, i + FIELDS);
    commits.push({
      hash,
      parents: parents ? parents.split(' ') : [],
      authorName,
      authorEmail,
      authorDate: Number.parseInt(authorDate, 10),
      subject,
      body: body.trimEnd(),
    });
  }
  return commits;
}
