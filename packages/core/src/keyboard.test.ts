import { describe, expect, it } from "vitest";
import { findButtonByText } from "./keyboard.js";

describe("findButtonByText", () => {
  const buttons = [
    { text: "签到" },
    { text: "今日打卡" },
    { text: "取消" },
  ];

  it("returns button when text exactly equals needle", () => {
    expect(findButtonByText(buttons, "签到")).toEqual({ text: "签到" });
  });

  it("returns first button whose text includes needle as substring", () => {
    expect(findButtonByText(buttons, "打卡")).toEqual({ text: "今日打卡" });
  });

  it("returns undefined when no button matches", () => {
    expect(findButtonByText(buttons, "不存在")).toBeUndefined();
  });

  it("returns undefined for empty button list", () => {
    expect(findButtonByText([], "签到")).toBeUndefined();
  });
});
