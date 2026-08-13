/**
    * A simple terminal status bar / spinner for real-time progress indication.
    */
class TerminalStatus {
  private interval: NodeJS.Timeout | null = null;
  private frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  private frameIndex = 0;
  private message = "";

  start(initialMessage: string) {
    this.message = initialMessage;
    if (this.interval) clearInterval(this.interval);
    this.interval = setInterval(() => {
      const frame = this.frames[this.frameIndex];
      this.frameIndex = (this.frameIndex + 1) % this.frames.length;
      process.stdout.write(`\r\x1b[36m${frame}\x1b[0m ${this.message} \x1b[K`);
    }, 80);
  }

  update(newMessage: string) {
    this.message = newMessage;
  }

  stop(finalMessage: string) {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    process.stdout.write(`\r\x1b[32m✔\x1b[0m ${finalMessage}\n`);
  }
}

export const status = new TerminalStatus();
