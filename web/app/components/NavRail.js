"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CharacterIcon,
  PlayersIcon,
  ScaleIcon,
  AuditIcon,
  FactionIcon,
  DevIcon,
  MessageIcon,
  NotesIcon,
  LifewebIcon,
  SignOutIcon,
  MoreIcon,
} from "./icons";
import { signOutOfDiscord } from "../actions";

const ICONS = {
  character: CharacterIcon,
  players: PlayersIcon,
  turns: ScaleIcon,
  audit: AuditIcon,
  faction: FactionIcon,
  dev: DevIcon,
  messages: MessageIcon,
  notes: NotesIcon,
  lifeweb: LifewebIcon,
};

// How many items stay in the mobile bottom bar. The rest go behind "More".
//
// A GM carries up to nine nav items (Character, Faction, Players, Adjudicate,
// Messages, Notes, Audit, Lifeweb, Dev) plus Sign out. Ten targets across a
// 390px viewport is ~39px each — under the 44px touch minimum, and visually
// crammed. Five plus More is ~65px. Players have 3-4 items and are unaffected
// by the cap; they still get the sheet, because Sign out lives in it on mobile.
const MOBILE_PRIMARY = 5;

export default function NavRail({ items }) {
  const pathname = usePathname();
  const [sheetOpen, setSheetOpen] = useState(false);

  const isActive = (href) => pathname === href || pathname.startsWith(`${href}/`);
  const overflow = items.slice(MOBILE_PRIMARY);

  return (
    <>
      <nav className="app-rail" aria-label="Main">
        {items.map((item, i) => {
          const Icon = ICONS[item.icon];
          return (
            <Link
              key={item.href}
              href={item.href}
              // Beyond the cap, an item is hidden in the bottom bar only —
              // the desktop rail still shows everything.
              className={i >= MOBILE_PRIMARY ? "rail-item rail-item--overflow" : "rail-item"}
              data-active={isActive(item.href) ? "true" : "false"}
            >
              <Icon aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          );
        })}

        {/* Mobile only; the desktop rail has room for everything plus a
            dedicated Sign out at the bottom. */}
        <button
          type="button"
          className="rail-item rail-more"
          aria-expanded={sheetOpen}
          onClick={() => setSheetOpen((v) => !v)}
        >
          <MoreIcon aria-hidden="true" />
          <span>More</span>
        </button>

        <form action={signOutOfDiscord} className="rail-signout">
          <button type="submit" className="rail-item" style={{ width: "100%" }}>
            <SignOutIcon aria-hidden="true" />
            <span>Sign out</span>
          </button>
        </form>
      </nav>

      {sheetOpen && (
        <div className="modal-overlay nav-sheet-overlay" onClick={() => setSheetOpen(false)}>
          <div className="nav-sheet" onClick={(e) => e.stopPropagation()}>
            {overflow.map((item) => {
              const Icon = ICONS[item.icon];
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="menu-item nav-sheet-item"
                  data-active={isActive(item.href) ? "true" : "false"}
                  // Close on the way out, or the sheet stays over the page you
                  // just asked for. Done here rather than in an effect on
                  // pathname, which would be a cascading render.
                  onClick={() => setSheetOpen(false)}
                >
                  <Icon aria-hidden="true" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
            <form action={signOutOfDiscord}>
              <button type="submit" className="menu-item nav-sheet-item" style={{ width: "100%" }}>
                <SignOutIcon aria-hidden="true" />
                <span>Sign out</span>
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
