import chalk from "chalk";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export interface Spinner {
  /** Update the message and advance the spinner frame. */
  update: (msg: string) => void;
  /** Clear the spinner line. */
  stop: () => void;
}

export function createSpinner(): Spinner {
  let frameIndex = 0;

  return {
    update(msg: string) {
      const frame = chalk.cyan(FRAMES[frameIndex++ % FRAMES.length]);
      process.stderr.write(`\r\x1b[K  ${frame} ${chalk.dim(msg)}`);
    },
    stop() {
      process.stderr.write("\r\x1b[K");
    },
  };
}
