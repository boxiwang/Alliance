export interface AllianceOption {
  ca: string;
  symbol: string;
  name: string;
  icon: string | null;
}

export default function AlliancePicker({
  alliances,
  selectedCA,
  onSelect,
}: {
  alliances: AllianceOption[];
  selectedCA: string | null;
  onSelect: (alliance: AllianceOption) => void;
}) {
  return (
    <div className="fgrid" aria-label="Available alliances">
      {alliances.map((alliance) => (
        <button
          key={alliance.ca}
          className={"fcard" + (selectedCA === alliance.ca ? " sel" : "")}
          onClick={() => onSelect(alliance)}
        >
          {alliance.icon ? <img className="ficon" src={alliance.icon} alt="" /> : <span className="femoji">🏴</span>}
          <span className="fsym">${alliance.symbol}</span>
          <span className="fname">{alliance.name}</span>
        </button>
      ))}
    </div>
  );
}
