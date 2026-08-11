// Where his relationships live between weeks.
//
// The contacts themselves are cheap; what matters is that the STANDING survives. A phone that
// forgets you ignored your father for a month is a phone with no consequences in it, which is
// what this whole surface was rebuilt to stop being.

import { LazyStore } from "@tauri-apps/plugin-store";
import type { Contact } from "./phone";

const store = new LazyStore("dynastywire.phone.json");
const KEY = (dynastyId: string) => `contacts::${dynastyId}`;

export async function loadContacts(dynastyId: string): Promise<Contact[]> {
  return (await store.get<Contact[]>(KEY(dynastyId))) ?? [];
}

export async function saveContacts(dynastyId: string, contacts: Contact[]): Promise<void> {
  await store.set(KEY(dynastyId), contacts.slice(0, 24));
  await store.save();
}

export async function clearContacts(dynastyId: string): Promise<void> {
  await store.delete(KEY(dynastyId));
  await store.save();
}
