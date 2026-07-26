export interface CommentReplyItem {
  /** Replies carry no id of their own, so position in the thread is the identity. */
  key: string;
  author: string;
  body: string;
}

interface Props {
  items: CommentReplyItem[];
  countLabel: string;
}

export function CommentReplies({ items, countLabel }: Props) {
  const replyElements = items.map((item) => (
    <li key={item.key} className="border-border/70 flex flex-col gap-1 border-l pl-3">
      <span className="text-ink text-xs font-medium">{item.author}</span>
      <p className="text-muted text-sm leading-relaxed break-words whitespace-pre-wrap">
        {item.body}
      </p>
    </li>
  ));

  return (
    <section aria-label="Replies" className="flex flex-col gap-2">
      <p className="text-muted/80 text-xs font-medium">{countLabel}</p>
      <ul role="list" className="flex flex-col gap-3">
        {replyElements}
      </ul>
    </section>
  );
}
