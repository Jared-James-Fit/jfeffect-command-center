import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { HoursWindow } from "@/lib/booking-slots";
import type { BookingType } from "@/lib/booking-types";

/** Booking types with their weekly hours. */
export function useBookingTypes(enabled = true) {
  return useQuery<BookingType[]>({
    queryKey: ["booking-types-admin"],
    enabled,
    queryFn: async () => {
      const [{ data: types, error }, { data: hours }] = await Promise.all([
        (supabase as any)
          .from("booking_cards")
          .select("*")
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true }),
        (supabase as any)
          .from("booking_card_hours")
          .select("booking_card_id, day_of_week, start_time, end_time"),
      ]);
      if (error) throw error;
      const byType = new Map<string, HoursWindow[]>();
      for (const h of (hours ?? []) as any[]) {
        if (!byType.has(h.booking_card_id)) byType.set(h.booking_card_id, []);
        byType.get(h.booking_card_id)!.push({
          day_of_week: h.day_of_week,
          start_time: String(h.start_time).slice(0, 5),
          end_time: String(h.end_time).slice(0, 5),
        });
      }
      return ((types ?? []) as any[]).map((t) => ({
        ...t,
        hours: byType.get(t.id) ?? [],
      })) as BookingType[];
    },
  });
}
