import { Fragment } from "react";
import { I } from "../icons";

type Props = {
  crumbs: string[];
  onSearch: () => void;
  onNew: () => void;
};

export function Topbar({ crumbs, onSearch, onNew }: Props) {
  return (
    <div className="topbar">
      <div className="crumbs">
        {crumbs.map((c, i) => (
          <Fragment key={i}>
            {i > 0 && <span className="sep">/</span>}
            <span className={`crumb ${i === crumbs.length - 1 ? "cur" : ""}`}>{c}</span>
          </Fragment>
        ))}
      </div>
      <div className="topbar-search" onClick={onSearch} role="button">
        <I name="search" size={13} />
        <span className="label">Search goals, people, docs…</span>
        <span className="kbd">⌘K</span>
      </div>
      <div className="topbar-actions">
        <span className="live-tag">
          <span className="dot" />
          11 agents live
        </span>
        <button className="btn btn-ghost btn-sm" title="Notifications">
          <I name="bell" size={14} />
        </button>
        <button className="btn btn-sm" onClick={onNew}>
          <I name="plus" size={12} /> New goal
        </button>
      </div>
    </div>
  );
}
