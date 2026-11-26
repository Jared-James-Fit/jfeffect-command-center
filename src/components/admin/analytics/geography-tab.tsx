/**
 * Audience & Geography: where people are, approximately, and where they turn into members and
 * clients. Places are the host's IP country and the device's time-zone city (never GPS, never a
 * person's location): the map has bubbles or a heat layer, sized by visits, visitors, new accounts
 * or paying clients, and the rankings say growth against the period before and sign-ups per visitor.
 */
import { useState } from "react";
import { Definitions, IntelSection } from "@/components/admin/intel/intel-ui";
import { PlaceMap, type MapMetric } from "@/components/admin/intel/place-map";
import { count, countryName, placeLabel, type GeographyView, type PlaceRow } from "@/lib/bi/model";
import { DataTable, Segmented, SinceNote, type Column } from "./bi-ui";
import { useBiTab, type TabProps } from "./analytics-page";

const METRICS: { value: MapMetric; label: string }[] = [
  { value: "sessions", label: "Visits" },
  { value: "visitors", label: "Visitors" },
  { value: "registered", label: "New accounts" },
  { value: "paying", label: "Paying" },
];

function growth(p: PlaceRow) {
  if (p.growth == null) return p.prevSessions === 0 && p.sessions > 0 ? <span className="text-[12px] text-muted-foreground">new</span> : "–"; // null: no visits recorded before
  return <span className={p.growth < 0 ? "text-muted-foreground" : ""}>{p.growth > 0 ? "+" : ""}{p.growth}%</span>;
}

const common: Column<PlaceRow>[] = [
  { key: "s", label: "Visits", align: "right", render: (r) => count(r.sessions), sort: (r) => r.sessions },
  { key: "g", label: "Growth", align: "right", render: growth, sort: (r) => r.growth },
  { key: "v", label: "Visitors", align: "right", render: (r) => count(r.visitors), sort: (r) => r.visitors },
  { key: "r", label: "New accounts", align: "right", render: (r) => count(r.registrations), sort: (r) => r.registrations },
  { key: "c", label: "Per 100 visitors", align: "right", render: (r) => (r.conversion == null ? "–" : r.conversion), sort: (r) => r.conversion },
  { key: "pe", label: "Registered", align: "right", render: (r) => count(r.people), sort: (r) => r.people },
  { key: "pa", label: "Paying", align: "right", render: (r) => count(r.paying), sort: (r) => r.paying },
];

export function GeographyTab({ range }: TabProps) {
  const q = useBiTab<GeographyView>("geography", range);
  const [metric, setMetric] = useState<MapMetric>("sessions");
  const [mode, setMode] = useState<"bubbles" | "heat">("bubbles");
  const v = q.data;
  if (!v) return <div />;
  const total = v.placedSessions + v.unplacedSessions;
  const places = v.cities
    .filter((c) => c.lat != null && c.lng != null)
    .map((c) => ({
      key: `${c.country}|${c.city ?? ""}`,
      label: placeLabel(c),
      lat: c.lat,
      lng: c.lng,
      people: c.people,
      visitors: c.visitors,
      sessions: c.sessions,
      live: c.live,
      registered: c.registrations,
      paying: c.paying,
    }));
  return (
    <div className="space-y-4">
      <SinceNote>
        Approximate: the country comes from the connection, the city from the device's time zone when it's in that country. Never GPS,
        never an address. {total ? `${Math.round((v.placedSessions / total) * 100)}% of visits in this period have a place.` : ""}{" "}
        {v.peopleTotal ? `${v.peoplePlaced} of ${v.peopleTotal} members and clients have a usual place.` : ""}
      </SinceNote>
      <IntelSection
        title="Map"
        sub="Drag to move, double-click or use the buttons to zoom; tap a place for its numbers"
        action={
          <div className="flex flex-wrap justify-end gap-2">
            <Segmented label="Map style" value={mode} onChange={setMode} options={[{ value: "bubbles", label: "Bubbles" }, { value: "heat", label: "Heat" }]} />
          </div>
        }
      >
        <div className="mb-3">
          <Segmented label="Size by" value={metric} onChange={setMetric} options={METRICS} />
        </div>
        <PlaceMap places={places} metric={metric} heat={mode === "heat"} height={380} />
      </IntelSection>
      <IntelSection title="Countries" sub="Ranked by visits; growth against the same number of days before">
        <DataTable rows={v.countries} rowKey={(r) => r.country} columns={[{ key: "n", label: "Country", render: (r) => <span className="font-medium">{countryName(r.country)}</span>, sort: (r) => countryName(r.country) }, ...common]} />
      </IntelSection>
      <div className="grid gap-4 xl:grid-cols-2">
        <IntelSection title="Provinces and states" sub="Only where the time zone names one (Toronto's is Ontario and Quebec, so it has none)">
          <DataTable rows={v.regions} rowKey={(r) => `${r.country}|${r.region}`} limit={10} columns={[{ key: "n", label: "Province / state", render: (r) => <span className="font-medium">{r.region}</span>, sort: (r) => r.region }, ...common.slice(0, 4), common[6]]} empty="No visits with a province or state in this period." />
        </IntelSection>
        <IntelSection title="Cities" sub="Approximate (the time zone's main city)">
          <DataTable rows={v.cities.filter((c) => c.city)} rowKey={(r) => `${r.country}|${r.city}`} limit={10} columns={[{ key: "n", label: "City", render: (r) => <span className="font-medium">{placeLabel(r)}</span>, sort: (r) => r.city }, ...common.slice(0, 4), common[6]]} empty="No visits with a city in this period." />
        </IntelSection>
      </div>
      <Definitions
        items={[
          { term: "Visits / visitors", text: "Visits started from that place in the period, and the browsers they came from." },
          { term: "New accounts", text: "People who joined in the period whose usual place (where most of their visits come from) is there." },
          { term: "Per 100 visitors", text: "New accounts there for every 100 visitors from there: a rough local conversion rate." },
          { term: "Registered / paying", text: "Every member or client whose usual place is there, and those who paid in the last 45 days." },
          { term: "Growth", text: "Visits against the same number of days before; “new” when there were none." },
        ]}
      />
    </div>
  );
}
