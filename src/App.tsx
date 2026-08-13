import { useRoute } from "./state/router.ts";
import { StoreProvider } from "./state/store.tsx";
import { Account } from "./screens/Account.tsx";
import { Banlist } from "./screens/Banlist.tsx";
import { Build } from "./screens/Build.tsx";
import { Collection } from "./screens/Collection.tsx";
import { Strategy } from "./screens/Strategy.tsx";
import { Upgrade } from "./screens/Upgrade.tsx";
import { Welcome } from "./screens/Welcome.tsx";

function Screens(): JSX.Element {
  const { route } = useRoute();
  switch (route.screen) {
    case "account":
      return <Account />;
    case "collection":
      return <Collection />;
    case "build":
      return <Build />;
    case "upgrade":
      return <Upgrade selected={route.param} />;
    case "strategy":
      return <Strategy selected={route.param} />;
    case "banlist":
      return <Banlist />;
    case "welcome":
    default:
      return <Welcome />;
  }
}

export function App(): JSX.Element {
  return (
    <StoreProvider>
      <Screens />
    </StoreProvider>
  );
}
