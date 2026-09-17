import type { TimeFormat } from "@deadline-radar/validation";

export type Profile = {
  id: string;
  email: string;
  name: string | null;
  timezone: string;
  timeFormat: TimeFormat;
  created_at: string;
};
