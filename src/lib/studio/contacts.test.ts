import { describe, expect, it } from "vitest";

import { contactsToText, parseContacts } from "./contacts";

describe("contacts as text", () => {
  it("parses name, email and role in any order the email lets it", () => {
    expect(parseContacts("Sam Lee · sam@acme.com · Marketing")).toEqual([{ name: "Sam Lee", email: "sam@acme.com", role: "Marketing" }]);
    expect(parseContacts("sam@acme.com")).toEqual([{ name: "", email: "sam@acme.com" }]);
    expect(parseContacts("Sam, sam@acme.com")).toEqual([{ name: "Sam", email: "sam@acme.com" }]);
    expect(parseContacts("sam@acme.com | Sam")).toEqual([{ name: "Sam", email: "sam@acme.com" }]);
  });
  it("skips blank lines and keeps one contact per line", () => {
    expect(parseContacts("\n a@x.co \n\n b@x.co · B\n")).toHaveLength(2);
  });
  it("a line with no email stays, so validation can say so", () => {
    expect(parseContacts("Sam Lee")).toEqual([{ name: "Sam Lee", email: "" }]);
  });
  it("round-trips", () => {
    const c = [{ name: "Sam Lee", email: "sam@acme.com", role: "Marketing" }, { name: "", email: "kim@acme.com" }];
    expect(parseContacts(contactsToText(c))).toEqual(c);
  });
});
