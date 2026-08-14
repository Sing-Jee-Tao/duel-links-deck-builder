import { AllowanceRail } from "../components/Allowance.tsx";
import { Footer, Masthead, Shell } from "../components/Chrome.tsx";
import { banlist } from "../data/index.ts";
import { BanlistIndex } from "../engine/banlist-index.ts";
import { idealDeck } from "../engine/build.ts";
import { computeAllowance } from "../engine/validator.ts";
import { href } from "../state/router.ts";
import { useStore } from "../state/store.tsx";

function effectiveDate(): string {
  return new Date(banlist.scrapedAt).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function Welcome(): JSX.Element {
  const { pool, build, config, templates } = useStore();

  // The peek shows the player's own allowance once they have a build; before
  // that, the strongest template's finished list stands in.
  const index = new BanlistIndex(banlist);
  const sample =
    build && build.mainCount > 0
      ? build.validation.allowance
      : pool && templates[0]
        ? computeAllowance(idealDeck(templates[0], index, pool.index, config), index)
        : null;

  const indexed = pool ? pool.cards.length.toLocaleString("en-GB") : "—";

  return (
    <Shell>
      <Masthead variant="landing" />

      <section className="hero" data-role="hero">
        <div className="hero__inner">
          <div className="hero__eyebrow">Deck builder · Forbidden &amp; Limited list · {effectiveDate()}</div>
          <h1 className="hero__title">Enter what you own. Get the strongest legal deck out of it.</h1>
          <p className="hero__lede">
            The solver reads your collection against the current Forbidden &amp; Limited lists, spends the three
            shared Limited allowances where they buy the most, and shows you exactly which cards move you up a
            tier.
          </p>
          <div className="cta-row">
            <a className="btn btn--primary btn--lg" href={href("collection")} data-role="primary-cta">
              Enter your collection
            </a>
            <a className="btn btn--lg" href={href("build")} data-role="secondary-cta">
              See a build
            </a>
          </div>
          <div className="hero__stats" data-role="hero-stats">
            <span>
              <strong>{indexed}</strong> cards indexed
            </span>
            <span>
              <strong>{templates.length}</strong> candidate decks scored per build
            </span>
            <span>
              <strong>weekly</strong> banlist refresh
            </span>
          </div>
        </div>
      </section>

      <section className="features" data-role="feature-list">
        <div className="feature" data-role="feature">
          <div className="feature__num">01 · COLLECTION</div>
          <h2 className="feature__title">A ledger, not a gallery</h2>
          <p className="feature__body">
            Type-ahead across the whole pool, quantity set in one click, filters on type, attribute, level and
            archetype. Built for the player entering four hundred cards in one sitting.
          </p>
          <a className="inline-link" href={href("collection")}>
            Open collection
          </a>
        </div>
        <div className="feature" data-role="feature">
          <div className="feature__num">02 · BUILD</div>
          <h2 className="feature__title">Solved under real constraints</h2>
          <p className="feature__body">
            20–30 main, five in the Extra, and three shared Limited allowances the solver has to spend wisely.
            Every build comes back with its legality reading attached.
          </p>
          <a className="inline-link" href={href("build")}>
            See a build
          </a>
        </div>
        <div className="feature" data-role="feature">
          <div className="feature__num">03 · UPGRADE</div>
          <h2 className="feature__title">The next deck, as a diff</h2>
          <p className="feature__body">
            Every tier deck you cannot build yet, shown against your current one: completion percentage, the
            copies you still need, and the cards that come out to make room.
          </p>
          <a className="inline-link" href={href("upgrade")}>
            See an upgrade path
          </a>
        </div>
      </section>

      <section className="peek" data-role="allowance-peek">
        <div className="peek__copy">
          <div className="label">The constraint the whole tool is built around</div>
          <h2 className="h1" style={{ marginTop: 10 }}>
            Limited tiers are allowances, not per-card badges
          </h2>
          <p
            className="feature__body"
            style={{ maxWidth: "52ch", fontSize: "var(--t-15)", lineHeight: 1.55, marginTop: 12 }}
          >
            You may run one card total from the Limited 1 pool, two from Limited 2, three from Limited 3.
            Picking one spends the slot for every other card in that tier. Deck Ledger shows the allowance as
            slots with the spent card's name written into them, on every screen, so you always know what a slot
            cost you.
          </p>
          <a className="inline-link" href={href("banlist")}>
            Current banlist
          </a>
        </div>

        {sample && <AllowanceRail allowance={sample} className="peek__rail allow" />}
      </section>

      <section className="features" data-role="secondary-features">
        <div className="feature" data-role="feature">
          <div className="feature__num">04 · STRATEGY</div>
          <h2 className="feature__title feature__title--serif">Written guidance, not a stat dump</h2>
          <p className="feature__body">
            Game plan, opening priorities, key interactions and matchup notes for every deck the solver hands
            you — written against the current list.
          </p>
          <a className="inline-link" href={href("strategy")}>
            Read a guide
          </a>
        </div>
        <div className="feature" data-role="feature">
          <div className="feature__num">05 · BANLIST</div>
          <h2 className="feature__title">Synced, and honest when it isn't</h2>
          <p className="feature__body">
            Forbidden and all three Limited pools, refreshed weekly. When the refresh goes stale the whole tool
            says so rather than quietly checking your deck against an old list.
          </p>
          <a className="inline-link" href={href("banlist")}>
            Banlist status
          </a>
        </div>
      </section>

      <section className="closing" data-role="closing-cta">
        <div style={{ flex: "1 1 320px" }}>
          <h2 className="feature__title" style={{ margin: 0, fontSize: 22 }}>
            Your collection stays on this device, and exports to a file you keep.
          </h2>
          <p className="feature__body" style={{ color: "var(--ink-3)" }}>
            Free. No account, no server, no card data leaving your browser.
          </p>
        </div>
        <div className="cta-row" style={{ marginTop: 0 }}>
          <a className="btn btn--primary btn--lg" href={href("collection")} data-role="primary-cta">
            Enter your collection
          </a>
          <a className="btn btn--lg" href={href("account")} data-role="secondary-cta">
            Profile &amp; backup
          </a>
        </div>
      </section>

      <Footer />
    </Shell>
  );
}
