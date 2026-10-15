import { configured, db } from "@/lib/supabase";
import { redirect } from "next/navigation";
import {
  Home,
  Snowflake,
  BookOpen,
  Dices,
  LogOut,
  Layers,
  MoreHorizontal,
  Wallet,
  CalendarDays,
  ShoppingBasket,
} from "lucide-react";
import { logout } from "../login/actions";
const links = [
  { href: "/", label: "Domov", icon: Home },
  { href: "/inventory", label: "Mraznička", icon: Snowflake },
  { href: "/recipes", label: "Recepty", icon: BookOpen },
  { href: "/surprise", label: "Prekvap ma!", icon: Dices },
  { href: "/portioning", label: "Porciovanie", icon: Layers },
];
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!configured()) redirect("/login");
  const client = await db();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) redirect("/login");
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">❄ FREEZER OS</div>
        <nav>
          {[
            ...links,
            { href: "/meal-plan", label: "Jedálniček", icon: CalendarDays },
            { href: "/meal-preps", label: "Meal prepy", icon: Layers },
            { href: "/shopping", label: "Nákupy", icon: ShoppingBasket },
            { href: "/food-cost", label: "Food Cost", icon: Wallet },
          ].map((x) => (
            <a href={x.href} key={x.href}>
              <x.icon size={20} />
              {x.label}
            </a>
          ))}
        </nav>
        <form action={logout} style={{ marginTop: 40 }}>
          <button>
            <LogOut size={16} />
            Odhlásiť sa
          </button>
        </form>
      </aside>
      <main>
        <div className="topline">Vaša každodenná kuchyňa · CZK</div>
        {children}
      </main>
      <nav className="bottom" aria-label="Hlavná navigácia">
        {[
          ...links.slice(0, 4),
          { href: "/more", label: "Viac", icon: MoreHorizontal },
        ].map((x) => (
          <a href={x.href} key={x.href}>
            <x.icon size={22} />
            {x.label}
          </a>
        ))}
        {/* Account actions are available from Preferences to keep five mobile tabs. */}
        <form action={logout} className="mobile-account-extra">
          <button aria-label="Odhlásiť sa">
            <LogOut size={18} />
          </button>
        </form>
      </nav>
    </div>
  );
}
