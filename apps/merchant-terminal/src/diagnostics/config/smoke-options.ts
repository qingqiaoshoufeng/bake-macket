export type DiagnosticSmokeOptions = Readonly<{
  host: '10.0.2.2';
  port: number;
  autoRun: true;
}>;

export const parseDiagnosticSmokeOptions = (
  options: Readonly<Record<string, string | undefined>>,
): DiagnosticSmokeOptions | null => {
  const port = Number(options.port);

  if (
    options.smoke !== 'true' ||
    options.host !== '10.0.2.2' ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535
  ) {
    return null;
  }

  return Object.freeze({ host: '10.0.2.2', port, autoRun: true });
};

export const parseDiagnosticSmokeUrl = (
  launchUrl: string,
): DiagnosticSmokeOptions | null => {
  try {
    const parsed = new URL(launchUrl);
    if (
      parsed.protocol !== 'bakemall-terminal:' ||
      parsed.hostname !== 'diagnostics' ||
      parsed.pathname !== ''
    ) {
      return null;
    }

    return parseDiagnosticSmokeOptions({
      smoke: parsed.searchParams.get('smoke') ?? undefined,
      host: parsed.searchParams.get('host') ?? undefined,
      port: parsed.searchParams.get('port') ?? undefined,
    });
  } catch {
    return null;
  }
};

export const buildDiagnosticSmokePageUrl = (
  options: DiagnosticSmokeOptions,
): string =>
  `/pages/diagnostics/DiagnosticsPage?smoke=true&host=${options.host}&port=${options.port}`;
