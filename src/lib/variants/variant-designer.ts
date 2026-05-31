export interface VariantDesignInput {
  controlId: string;
  hypothesis: string;
  variable: "hook" | "product_size" | "product_position" | "cta" | "price_position" | "color" | "background" | "first_3s" | "subtitle_density" | "audio_hook" | "placement_ratio";
  primaryMetric?: string;
}

export interface VariantDesign {
  control: string;
  variants: Array<{
    name: "A" | "B" | "C";
    changedVariable: VariantDesignInput["variable"];
    controlledVariables: string[];
    primaryMetric: string;
    secondaryMetrics: string[];
    minimumData: string;
    stopCondition: string;
  }>;
}

export function designVariants(input: VariantDesignInput): VariantDesign {
  return {
    control: input.controlId,
    variants: [
      {
        name: "A",
        changedVariable: input.variable,
        controlledVariables: [
          "campaign objective",
          "audience",
          "budget recommendation only",
          "landing URL",
          "offer facts",
          "placement unless testing placement_ratio"
        ],
        primaryMetric: input.primaryMetric ?? defaultPrimaryMetric(input.variable),
        secondaryMetrics: ["CTR", "LPV rate", "ATC rate", "purchase rate"],
        minimumData: "impressions >= 1,500, link_clicks >= 50, landing_page_views >= 30",
        stopCondition: "High confidence 기준 전에는 원인 단정 금지. 정책 위험 또는 비용 한도 초과 시 중단."
      }
    ]
  };
}

function defaultPrimaryMetric(variable: VariantDesignInput["variable"]): string {
  if (variable === "hook" || variable === "first_3s") return "CTR / first 3s retention";
  if (variable === "price_position" || variable === "cta") return "CVR / purchase rate";
  if (variable === "placement_ratio") return "placement delivery and #1487569 error-free draft rate";
  return "link CTR";
}
