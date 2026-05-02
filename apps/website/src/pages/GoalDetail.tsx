import { Stub } from "./Stub";

type Props = { goalId: string | null };

export function GoalDetail({ goalId }: Props) {
  return (
    <Stub
      eyebrow={goalId ? `Goal · ${goalId}` : "Goal"}
      title="Goal detail."
      body="Heartbeat timeline, key results, contributors. Wired in S2."
    />
  );
}
