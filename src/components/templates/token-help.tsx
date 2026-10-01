import { TOKENS } from "@/domain/personalization";

/** Reference list of personalization fields (shared by template and sequence editors). */
export function TokenHelp() {
  return (
    <details className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
      <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
        Personalization fields
      </summary>
      <p className="mt-2 text-xs text-muted-foreground">
        Write <code>{"{{first_name}}"}</code> to insert a value. Add a fallback for empty values
        with <code>{"{{first_name|there}}"}</code>. Without a fallback, a prospect missing that
        value is held back at launch, so nobody receives “Hi ,”.
      </p>
      <ul className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
        {Object.entries(TOKENS).map(([k, label]) => (
          <li key={k} className="text-xs">
            <code className="text-foreground">{`{{${k}}}`}</code>{" "}
            <span className="text-muted-foreground">{label}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** A fictional sample contact used for previews. */
export const SAMPLE_VALUES = {
  first_name: "Avery",
  last_name: "Collins",
  contact_name: "Avery Collins",
  contact_title: "Practice Manager",
  company_name: "Lone Star Family Clinic",
  provider_type: "Family Medicine",
  city: "Austin",
  state: "TX",
  country: "United States",
  website: "lonestar-family-clinic.example",
  sender_name: "Alex Romero",
} as const;
