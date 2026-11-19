import { POA_INPUT, text } from "@brainary/poa-sdk";

export type CoffeeType = "americano" | "latte" | "cappuccino";

export interface PoaInput {
  coffee?: string;
}

export interface CoffeeRecipe {
  coffee: CoffeeType;
  name: string;
  ingredients: string[];
  steps: string[];
  total_time_minutes: number;
}

const recipes: Record<CoffeeType, CoffeeRecipe> = {
  americano: {
    coffee: "americano",
    name: "美式咖啡",
    ingredients: ["浓缩咖啡 30ml", "热水 150ml"],
    steps: ["萃取一份浓缩咖啡。", "加入热水。"],
    total_time_minutes: 3,
  },
  latte: {
    coffee: "latte",
    name: "拿铁咖啡",
    ingredients: ["浓缩咖啡 30ml", "热牛奶 180ml", "奶泡 1cm"],
    steps: [
      "萃取一份浓缩咖啡。",
      "加热牛奶并打出薄奶泡。",
      "将牛奶缓慢倒入咖啡中。",
    ],
    total_time_minutes: 5,
  },
  cappuccino: {
    coffee: "cappuccino",
    name: "卡布奇诺",
    ingredients: ["浓缩咖啡 30ml", "热牛奶 60ml", "奶泡 60ml"],
    steps: [
      "萃取一份浓缩咖啡。",
      "加热牛奶并打出厚奶泡。",
      "先倒入热牛奶，再铺上奶泡。",
    ],
    total_time_minutes: 5,
  },
};

export function run(input: PoaInput = {}): CoffeeRecipe {
  const coffee = input.coffee as CoffeeType;
  return recipes[coffee] ?? recipes.americano;
}

if (POA_INPUT !== undefined) {
  text(run(POA_INPUT as PoaInput));
}
