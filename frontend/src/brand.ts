export function banner() {
  const art = `
    _    ___  ____                            _
   / \\  |_ _|/ ___|___  _ __  _ __   ___  ___| |_
  / _ \\  | || |   / _ \\| '_ \\| '_ \\ / _ \\/ __| __|
 / ___ \\ | || |__| (_) | | | | | | |  __/ (__| |_
/_/   \\_\\___|\\____\\___/|_| |_|_| |_|\\___|\\___|\\__|

  AIConnect · Your team. Your code. Connected agents.
`;
  process.stderr.write(process.stderr.isTTY && !process.env.NO_COLOR ? `\x1b[36m${art}\x1b[0m\n` : art+'\n');
}
export function connectionLabel(status:any) {
  return `${status.connected?'Connected':'Companion ready · relay not connected'}${status.member?' · @'+status.member.handle:''}${status.network?.name?' · '+status.network.name:''}`;
}
