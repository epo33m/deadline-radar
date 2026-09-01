function getZonedHour(date: Date, timeZone: string): number {
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    hourCycle: "h23",
  })
    .formatToParts(date)
    .find((part) => part.type === "hour")?.value;

  return hour ? Number(hour) : 0;
}

export function getOverviewGreeting(now: Date, timeZone: string): string {
  const hour = getZonedHour(now, timeZone);

  if (hour < 12) return "Good morning.";
  if (hour < 17) return "Good afternoon.";
  return "Good evening.";
}
