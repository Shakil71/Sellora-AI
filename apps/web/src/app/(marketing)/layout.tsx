import { SiteFooter, SiteHeader } from '@/components/marketing/site';
import { getHome } from '@/lib/home-content';

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const { content } = await getHome();
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader brandName={content.brandName} />
      <main className="flex-1">{children}</main>
      <SiteFooter brandName={content.brandName} description={content.footer.description} legal={content.footer.legal} />
    </div>
  );
}
