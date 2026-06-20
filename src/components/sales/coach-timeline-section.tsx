import { Section, SectionTitle } from "./sales-page-shell";
import coachTimeline from "@/assets/coach-timeline.png.asset.json";

export function CoachTimelineSection() {
  return (
    <Section className="bg-card/30">
      <SectionTitle
        eyebrow="The Coach"
        title="This Was Built"
        sub="From 2014 to now — the same discipline, the same standards."
      />
      <div className="mx-auto max-w-5xl">
        <img
          src={coachTimeline.url}
          alt="Coach Jared transformation timeline — started from zero in 2014, figured it out 2018-2021, made the shift, no backup plan, 100+ clients built"
          loading="lazy"
          decoding="async"
          className="w-full rounded-2xl object-cover ring-1 ring-white/5"
        />
      </div>
    </Section>
  );
}
