import type { ReactNode } from "react";
import type { HappyStage, Stage } from "../../shared/types";
import { STAGE_LABELS } from "../lib/stageLabels";
import { STAGE_GROUPS, groupIndexForStage, representativeStage } from "../lib/stageGroups";
import { CheckIcon, ExclamationIcon } from "./ui/icons";
import Button from "./ui/Button";

export default function StageTrack({
  stage,
  hasError,
  errorMessage,
  onStageClick,
  onRetry,
  retrying,
}: {
  stage: Stage;
  hasError: boolean;
  /** The stored plain-language failure message for the current stage, if hasError. */
  errorMessage?: string | null;
  /** Called with a stage the request has actually reached (current or earlier) — future stages aren't clickable. */
  onStageClick?: (stage: Stage) => void;
  /** Retries the (single) current, failed stage — scoped to that step, not a page-wide action. */
  onRetry?: () => void;
  retrying?: boolean;
}) {
  // 'sources_insufficient' is a branch off 'researching', not a step on
  // the happy path (see shared/types.ts) — render the linear track as
  // if still at 'researching' (done, since we've moved past it) and
  // append a distinct warning node for the branch instead of trying to
  // fit it into the group index's past/current logic.
  const isInsufficient = stage === "sources_insufficient";
  const effectiveStage: HappyStage = isInsufficient ? "researching" : stage;
  const currentGroupIndex = groupIndexForStage(effectiveStage);

  function node(key: string, label: string, i: number, clickTarget: Stage | null, isBranch: boolean) {
    let circleClass = "stage-circle";
    let nodeClass = "stage-node";
    let content: ReactNode = i + 1;
    const reached = isBranch || i <= currentGroupIndex;

    if (isBranch) {
      circleClass += " is-error";
      nodeClass += " is-branch";
      content = <ExclamationIcon size={14} />;
    } else if (i === currentGroupIndex) {
      circleClass += hasError ? " is-error" : " is-current";
      content = hasError ? <ExclamationIcon size={14} /> : i + 1;
    } else if (i < currentGroupIndex) {
      circleClass += " is-past";
      content = <CheckIcon size={14} />;
    }
    if (reached) nodeClass += " is-reached";
    if (i === currentGroupIndex && !isBranch) nodeClass += " is-current";

    const circle =
      reached && onStageClick && clickTarget ? (
        <button className={circleClass} onClick={() => onStageClick(clickTarget)} type="button" aria-label={label}>
          {content}
        </button>
      ) : (
        <span className={circleClass}>{content}</span>
      );

    return (
      <div className={nodeClass} key={key}>
        {circle}
        <span className="stage-node-label">{label}</span>
      </div>
    );
  }

  return (
    <div>
      <div className="stage-track-scroll">
        <div className="stage-track">
          {STAGE_GROUPS.map((g, i) => node(g.key, g.label, i, representativeStage(g), false))}
          {isInsufficient &&
            node(
              "sources_insufficient",
              STAGE_LABELS.sources_insufficient,
              STAGE_GROUPS.length,
              "sources_insufficient",
              true,
            )}
        </div>
      </div>

      {hasError && errorMessage && (
        <div className="stage-failure">
          <div className="stage-failure-head">
            <ExclamationIcon />
            <span>
              Failed at <strong>{STAGE_LABELS[stage]}</strong>: {errorMessage}
            </span>
          </div>
          {onRetry && (
            <Button variant="danger" size="sm" onClick={onRetry} loading={retrying}>
              Retry this stage
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
