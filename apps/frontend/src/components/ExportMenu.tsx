import { Check, ChevronDown, Download, FileJson, FileText, Printer, X } from 'lucide-react';
import { Button } from '@components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@components/ui/dropdown-menu';
import type { Locale } from '@lib/i18n/switchLocalePath';
import { useCopy } from '@lib/useCopy';
import { m } from '@paraglide/messages.js';

/**
 * One menu for getting the report out: copy or download, as JSON or Markdown. The text is built on click only.
 * The menu closes on a pick, so a copy is confirmed (or its failure shown) on the trigger for a moment.
 */
type ExportMenuProps = { getJson: () => string; getMarkdown: () => string; filename: string; printHref: string; locale: Locale };

export const ExportMenu = (props: ExportMenuProps) => {
    const { locale } = props;
    const { state, copy } = useCopy();

    const download = (text: string, extension: string, type: string) => {
        const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `${props.filename}.${extension}`;
        link.click();
        // Revoked a moment later: some browsers start reading the file only after the click has returned.
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    return (
        <DropdownMenu>
            <DropdownMenuTrigger
                render={
                    <Button
                        variant={'ghost'}
                        size={'sm'}
                    />
                }
            >
                {state === 'copied' ? <Check aria-hidden={'true'} /> : state === 'failed' ? <X aria-hidden={'true'} /> : <Download aria-hidden={'true'} />}
                <span aria-live={'polite'}>
                    {state === 'copied' ? m.report_detail_copied({}, { locale }) : state === 'failed' ? m.report_copy_failed({}, { locale }) : m.report_table_export({}, { locale })}
                </span>
                <ChevronDown aria-hidden={'true'} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align={'end'}>
                <DropdownMenuGroup>
                    <DropdownMenuLabel>{m.report_table_export_copy({}, { locale })}</DropdownMenuLabel>
                    <DropdownMenuItem onClick={() => copy(props.getJson())}>
                        <FileJson aria-hidden={'true'} />
                        JSON
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => copy(props.getMarkdown())}>
                        <FileText aria-hidden={'true'} />
                        Markdown
                    </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                    <DropdownMenuLabel>{m.report_table_export_download({}, { locale })}</DropdownMenuLabel>
                    <DropdownMenuItem onClick={() => download(props.getJson(), 'json', 'application/json')}>
                        <FileJson aria-hidden={'true'} />
                        JSON
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => download(props.getMarkdown(), 'md', 'text/markdown')}>
                        <FileText aria-hidden={'true'} />
                        Markdown
                    </DropdownMenuItem>
                    {/* The print page has its own button that opens the print dialog, so it is a page of its own, in a new tab. */}
                    <DropdownMenuItem onClick={() => window.open(props.printHref, '_blank', 'noopener')}>
                        <Printer aria-hidden={'true'} />
                        PDF
                    </DropdownMenuItem>
                </DropdownMenuGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
};
