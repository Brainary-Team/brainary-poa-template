import { describe, expect, it } from "vitest";
import { run } from "../src/main.js";

describe("PoA business logic", () => {
  it("returns the requested coffee recipe", () => {
    expect(run({ coffee: "latte" })).toEqual({
      coffee: "latte",
      name: "拿铁咖啡",
      ingredients: ["浓缩咖啡 30ml", "热牛奶 180ml", "奶泡 1cm"],
      steps: [
        "萃取一份浓缩咖啡。",
        "加热牛奶并打出薄奶泡。",
        "将牛奶缓慢倒入咖啡中。",
      ],
      total_time_minutes: 5,
    });
  });

  it("uses Americano for an unknown coffee type", () => {
    expect(run({ coffee: "mocha" })).toMatchObject({
      coffee: "americano",
      name: "美式咖啡",
    });
  });
});
