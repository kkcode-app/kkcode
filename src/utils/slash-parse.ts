/**
 * Slash command parsing helpers used by ChatScreen.
 *
 * Pure functions — extracted so send-time parsing and input-time autocomplete
 * share explicit, unit-tested rules without spinning up the React tree (see
 * test/slash-parse.test.ts).
 *
 * Rules:
 *   - Input must start with `/` to be a slash command at all
 *   - Only the FIRST line is parsed for `cmd <args>` shape;
 *     subsequent lines are appended to arguments verbatim (preserving
 *     multi-line content like `<system-reminder>` snippets)
 *   - `name` does NOT include the leading `/`
 *   - Empty name (i.e. just `/`) is still a slash command syntactically
 *     but will fail the byName lookup downstream and fall back to
 *     sendPrompt — the parser still returns it as { name: "" } for
 *     consistency with the rest of the flow
 */
export type SlashParseResult = {
  name: string;
  arguments: string;
};

export type SlashCommandSuggestion = {
  name: string;
  description?: string;
};

/**
 * Return the currently typed command token (without `/`) while autocomplete
 * should be visible.
 *
 * Only a slash at the very start of an otherwise whitespace-free input opens
 * suggestions. As soon as the user types a space, tab or newline they have
 * moved on to command arguments, so the suggestions close.
 */
export function getSlashCommandQuery(text: string): string | null {
  if (!text.startsWith("/")) return null;
  const query = text.slice(1);
  return /\s/.test(query) ? null : query;
}

/**
 * Rank autocomplete candidates without mutating the server-owned command
 * array. Exact and prefix name matches come first, followed by name substring
 * and description matches; ties preserve the server's original order.
 */
export function filterSlashCommandSuggestions<T extends SlashCommandSuggestion>(
  commands: readonly T[],
  query: string,
): T[] {
  const needle = query.toLowerCase();
  if (!needle) return [...commands];

  return commands
    .map((command, index) => {
      const name = command.name.toLowerCase();
      const description = command.description?.toLowerCase() ?? "";
      const rank =
        name === needle
          ? 0
          : name.startsWith(needle)
            ? 1
            : name.includes(needle)
              ? 2
              : description.includes(needle)
                ? 3
                : -1;
      return { command, index, rank };
    })
    .filter((candidate) => candidate.rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((candidate) => candidate.command);
}

export function parseSlashCommandText(text: string): SlashParseResult | null {
  if (!text.startsWith("/")) return null;

  const firstLineEnd = text.indexOf("\n");
  // Normalize CRLF before tokenizing. Without this, a pasted `/init\r\n`
  // becomes the command name `init\r` and incorrectly falls through.
  const rawFirstLine = firstLineEnd === -1 ? text : text.slice(0, firstLineEnd);
  const firstLine = rawFirstLine.endsWith("\r") ? rawFirstLine.slice(0, -1) : rawFirstLine;
  const restOfInput = firstLineEnd === -1 ? "" : text.slice(firstLineEnd + 1);

  // Treat spaces and tabs as token separators, but preserve every character
  // after the first separator verbatim for server-side argument expansion.
  const firstWhitespace = firstLine.search(/\s/);
  const name = (firstWhitespace === -1 ? firstLine : firstLine.slice(0, firstWhitespace)).slice(1);
  const firstLineArgs = firstWhitespace === -1 ? "" : firstLine.slice(firstWhitespace + 1);
  const args = firstLineArgs + (restOfInput ? "\n" + restOfInput : "");
  return { name, arguments: args };
}
