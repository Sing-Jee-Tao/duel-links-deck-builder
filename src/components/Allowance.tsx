/**
 * The allowance rail — the signature element.
 *
 * Limited 1 / 2 / 3 are shared pools, not per-card limits. Each tier draws a
 * fixed number of slots and a spent slot has the occupying card's name written
 * into it, so the player reads what the allowance was spent *on*, not merely how
 * much is left. Empty slots are dashed outlines labelled "open".
 */
import type { AllowanceState } from "../engine/types.ts";

export interface AllowanceRailProps {
  allowance: AllowanceState;
  /** Heading on the dark strip; "Allowance" on Collection and Build. */
  title?: string;
  /** The shared-pool explainer under the head. */
  note?: string;
  /** Marks slots that changed, for the Upgrade screen's projection. */
  annotations?: Record<string, "KEPT" | "NEW" | "FREED">;
  className?: string;
  role?: "allowance-rail" | "allowance-delta";
}

export function AllowanceRail({
  allowance,
  title = "Allowance",
  note,
  annotations,
  className = "allow",
  role = "allowance-rail",
}: AllowanceRailProps): JSX.Element {
  return (
    <div className={className} data-role={role}>
      <div className="allow__head">
        <span>{title}</span>
        <span
          data-role="allowance-summary"
          {...(allowance.spent >= allowance.total ? { style: { color: "var(--ochre)" } } : {})}
        >
          {allowance.spent}/{allowance.total} SPENT
        </span>
      </div>
      {note && <p className="allow__note">{note}</p>}
      {allowance.tiers.map((tier) => {
        // One rendered slot per copy: two copies of a Limited 3 card spend two
        // slots, and the rail has to show that.
        const spent = tier.slots.flatMap((slot) =>
          Array.from({ length: slot.copies }, () => slot.name),
        );
        const open = Math.max(0, tier.budget - spent.length);
        return (
          <div className="allow__tier" data-role="allowance-tier" data-tier={tier.tier} key={tier.tier}>
            <div className="allow__tier-label">
              LIMITED {tier.tier}
              <div className="allow__tier-count" data-role="tier-count">
                {tier.used}/{tier.budget}
              </div>
            </div>
            <div className="allow__slots">
              {spent.map((name, i) => {
                const note = annotations?.[name.toLowerCase()];
                return (
                  <div className="allow__slot" data-role="allowance-slot" key={`${name}-${i}`}>
                    <span>{name}</span>
                    {note && (
                      <span className="mono" style={{ fontSize: "var(--t-11)", color: "var(--ochre)" }}>
                        {note}
                      </span>
                    )}
                  </div>
                );
              })}
              {Array.from({ length: open }, (_, i) => (
                <div
                  className="allow__slot allow__slot--empty"
                  data-role="allowance-slot-empty"
                  key={`open-${i}`}
                >
                  open
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export const ALLOWANCE_NOTE = "Each tier is one shared pool across the whole deck, not a per-card limit.";
