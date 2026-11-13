import { Fragment, type ReactNode } from 'react';
import { Link } from 'wouter';
import { parseRich } from '../lib/rich';

/** Renderiza a marcação mínima dos textos de tradução (negrito, código, links). */
export function Rich({ text }: { text: string }) {
  return (
    <>
      {parseRich(text).map((node, i): ReactNode => {
        switch (node.type) {
          case 'strong':
            return <strong key={i}>{node.value}</strong>;
          case 'code':
            return <code key={i}>{node.value}</code>;
          case 'link':
            return node.external ? (
              <a key={i} href={node.href} target="_blank" rel="noopener noreferrer">
                {node.label}
              </a>
            ) : (
              <Link key={i} href={node.href}>
                {node.label}
              </Link>
            );
          default:
            return <Fragment key={i}>{node.value}</Fragment>;
        }
      })}
    </>
  );
}

/** Lista de parágrafos (valor array na tradução). */
export function Paragraphs({ items }: { items: string[] }) {
  return (
    <>
      {items.map((text, i) => (
        <p key={i}>
          <Rich text={text} />
        </p>
      ))}
    </>
  );
}
