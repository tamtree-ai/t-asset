/** Prints an OWNER_PASSWORD_HASH for the password typed (not echoed). Usage: pnpm hash-password */
import { createInterface } from "node:readline";

import { hashPassword } from "../src/lib/password";

async function ask(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const c of process.stdin) chunks.push(c as Buffer);
    return Buffer.concat(chunks).toString("utf8").trim();
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
  out._writeToOutput = (s: string) => out.output.write(s.startsWith(question) ? s : "");
  const answer = await new Promise<string>((resolve) => rl.question(question, resolve));
  rl.close();
  process.stdout.write("\n");
  return answer;
}

ask("Password (10+ characters): ")
  .then(hashPassword)
  .then((h) => console.log(h))
  .catch((e) => {
    console.error((e as Error).message);
    process.exit(1);
  });
