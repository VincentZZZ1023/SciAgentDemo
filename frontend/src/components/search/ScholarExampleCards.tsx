export interface ScholarExampleItem {
  id: string;
  category: string;
  prompt: string;
}

interface ScholarExampleCardsProps {
  items: ScholarExampleItem[];
  onSelect?: (item: ScholarExampleItem) => void;
}

export const ScholarExampleCards = ({ items, onSelect }: ScholarExampleCardsProps) => {
  return (
    <section className="scholar-examples">
      <h2>Try SciAgent Demo Prompts</h2>
      <div className="scholar-example-list">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className="scholar-example-card"
            onClick={() => onSelect?.(item)}
          >
            <span className="scholar-example-tag">{item.category}</span>
            <p>{item.prompt}</p>
          </button>
        ))}
      </div>
    </section>
  );
};
