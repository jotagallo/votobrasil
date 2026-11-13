import { Link } from 'wouter';
import { UF_NAMES, type AreaSummary, type OfficeId } from '@votobr/shared';
import { useT } from '../i18n';
import { areaPath } from '../lib/routes';

export function AreaList({
  office,
  areas,
  query,
}: {
  office: OfficeId;
  areas: AreaSummary[];
  query: string;
}) {
  const { t, f } = useT();
  const municipal = office === 'municipal';
  const sorted = [...areas].sort((a, b) =>
    municipal ? b.electorate - a.electorate : a.name.localeCompare(b.name),
  );
  return (
    <div className="table-scroll" tabIndex={0} role="region" aria-label={t('areas.label')}>
      <table className="data-table data-table--areas">
        <caption className="sr-only">{t('areas.label')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('areas.name')}</th>
            {municipal ? <th scope="col">{t('areas.uf')}</th> : null}
            <th scope="col" className="num">
              {t('areas.seats')}
            </th>
            <th scope="col" className="num">
              {t('areas.electorate')}
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((area) => (
            <tr key={area.code}>
              <th scope="row">
                <Link href={`${areaPath(office, area.code)}${query}`}>
                  {municipal
                    ? area.name
                    : (UF_NAMES[area.code as keyof typeof UF_NAMES] ?? area.name)}
                </Link>
              </th>
              {municipal ? <td>{area.uf}</td> : null}
              <td className="num">{f.int(area.seats)}</td>
              <td className="num">{f.int(area.electorate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
