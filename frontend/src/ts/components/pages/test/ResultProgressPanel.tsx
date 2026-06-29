import { ChartData } from "chart.js";
import { createMemo, createSignal, JSXElement, Show } from "solid-js";

import { getConfig } from "../../../config/store";
import { createEffectOn } from "../../../hooks/effects";
import { getResultVisible, getTestProgressContext } from "../../../states/test";
import { Formatting } from "../../../utils/format";
import {
  buildProgressSnapshot,
  ProgressSnapshotData,
} from "../../../utils/result-progress";
import { ChartJs } from "../../common/ChartJs";
import { Fa } from "../../common/Fa";

export function ResultProgressPanel(): JSXElement {
  const [snapshot, setSnapshot] = createSignal<ProgressSnapshotData | null>(
    null,
  );
  const format = createMemo(() => new Formatting(getConfig));

  createEffectOn(
    () => [getResultVisible(), getTestProgressContext()] as const,
    async ([visible, context]) => {
      if (!visible || context === null) {
        setSnapshot(null);
        return;
      }

      const data = await buildProgressSnapshot(
        context.completedEvent,
        context.sessionMistakes,
      );

      if (!getResultVisible() || getTestProgressContext() !== context) {
        return;
      }

      setSnapshot(data);
    },
  );

  const showPanel = createMemo(
    () => getResultVisible() && getTestProgressContext() !== null,
  );

  return (
    <Show when={showPanel()}>
      <div class="bg-bg-2 mx-auto mt-6 max-w-240 rounded-lg border border-sub/30 p-6 text-text">
        <h3 class="mb-4 flex items-center gap-2 text-lg text-sub">
          <Fa icon="fa-chart-line" />
          <span>Progress snapshot</span>
        </h3>

        <Show
          when={snapshot()}
          fallback={
            <p class="text-sub">Calculating your progress snapshot...</p>
          }
        >
          {(data) => {
            const progress = data();
            const unit = format().typingSpeedUnit;

            return (
              <div class="flex flex-col gap-4 text-sm">
                <Show when={progress.vsLastTest}>
                  {(last) => (
                    <Section title="vs last test">
                      <div class="flex flex-wrap gap-4">
                        <Delta
                          label={unit}
                          value={last().wpmDelta}
                          formatter={(val) =>
                            formatSigned(
                              format().typingSpeed(Math.abs(val), {
                                showDecimalPlaces: true,
                              }),
                              val,
                            )
                          }
                        />
                        <Delta
                          label="acc"
                          value={last().accDelta}
                          formatter={(val) =>
                            formatSigned(
                              `${Math.abs(val).toFixed(1)}%`,
                              val,
                              true,
                            )
                          }
                          invertColors
                        />
                        <Delta
                          label="errors"
                          value={-last().errDelta}
                          formatter={(val) =>
                            formatSigned(`${Math.abs(val)}`, val, true)
                          }
                          invertColors
                        />
                      </div>
                    </Section>
                  )}
                </Show>

                <Show when={progress.vsLast10Avg}>
                  {(avg) => (
                    <Section title="vs your average">
                      <p>
                        {avg().wpmDelta >= 0 ? "Above" : "Below"} 10-test
                        average by{" "}
                        <span class={deltaClass(avg().wpmDelta >= 0, false)}>
                          {format().typingSpeed(Math.abs(avg().wpmDelta), {
                            showDecimalPlaces: true,
                          })}
                        </span>{" "}
                        ({format().typingSpeed(avg().avgWpm)} avg)
                      </p>
                    </Section>
                  )}
                </Show>

                <Show when={progress.vsPb}>
                  {(pb) => (
                    <Section title="vs personal best">
                      <p>
                        <Show
                          when={pb().isNewPb}
                          fallback={
                            <>
                              {format().typingSpeed(Math.abs(pb().gap), {
                                showDecimalPlaces: true,
                              })}{" "}
                              below PB ({format().typingSpeed(pb().pbWpm)})
                            </>
                          }
                        >
                          New personal best!
                        </Show>
                      </p>
                    </Section>
                  )}
                </Show>

                <Section title="today">
                  <p>
                    {progress.today.tests} test
                    {progress.today.tests === 1 ? "" : "s"} ·{" "}
                    {progress.today.typingLabel} typed
                    <Show when={progress.today.streak !== null}>
                      {" "}
                      · day {progress.today.streak} streak
                    </Show>
                  </p>
                </Section>

                <Show
                  when={progress.trend}
                  fallback={
                    <Show when={!progress.hasEnoughForTrend}>
                      <p class="text-sub">
                        Complete more tests to unlock weekly trends.
                      </p>
                    </Show>
                  }
                >
                  {(trend) => (
                    <Section title="trend">
                      <p>
                        7-day avg {format().typingSpeed(trend().currentWeekAvg)}{" "}
                        (
                        <span class={deltaClass(trend().delta >= 0, false)}>
                          {trend().delta >= 0 ? "↑" : "↓"}{" "}
                          {format().typingSpeed(Math.abs(trend().delta), {
                            showDecimalPlaces: true,
                          })}
                        </span>{" "}
                        vs prior week)
                      </p>
                    </Section>
                  )}
                </Show>

                <Show when={progress.hasEnoughForTrend}>
                  <div class="h-16">
                    <ChartJs
                      name="result-progress-sparkline"
                      type="line"
                      data={sparklineData(progress.sparklineWpm)}
                      options={{
                        animation: false,
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                          legend: { display: false },
                          tooltip: { enabled: false },
                        },
                        scales: {
                          x: { display: false },
                          y: { display: false },
                        },
                        elements: {
                          line: { tension: 0.35, borderWidth: 2 },
                          point: { radius: 0 },
                        },
                      }}
                    />
                  </div>
                </Show>

                <Show when={progress.thisTestMistakes}>
                  {(mistakes) => (
                    <Section title="this test">
                      <p>Mistakes: {mistakes()}</p>
                    </Section>
                  )}
                </Show>

                <Show when={progress.recoveryInsight}>
                  {(insight) => <p class="text-sub">{insight()}</p>}
                </Show>
              </div>
            );
          }}
        </Show>
      </div>
    </Show>
  );
}

function Section(props: { title: string; children: JSXElement }): JSXElement {
  return (
    <div>
      <div class="mb-1 text-xs tracking-wide text-sub uppercase">
        {props.title}
      </div>
      {props.children}
    </div>
  );
}

function Delta(props: {
  label: string;
  value: number;
  formatter: (value: number) => string;
  invertColors?: boolean;
}): JSXElement {
  return (
    <span>
      <span class="text-sub">{props.label} </span>
      <span
        classList={{
          "text-main":
            (props.invertColors
              ? props.value < 0 || props.value === 0
              : props.value > 0) && props.value !== 0,
          "text-error": props.invertColors ? props.value > 0 : props.value < 0,
          "text-text": props.value === 0,
        }}
      >
        {props.value === 0 ? "—" : props.formatter(props.value)}
      </span>
    </span>
  );
}

function formatSigned(
  magnitude: string,
  value: number,
  invert = false,
): string {
  if (value === 0) return "—";
  const sign = value > 0 ? "+" : "-";
  if (invert) {
    return value > 0 ? `+${magnitude}` : `-${magnitude}`;
  }
  return `${sign}${magnitude}`;
}

function deltaClass(positive: boolean, invert: boolean): string {
  const good = invert ? !positive : positive;
  return good ? "text-main" : "text-error";
}

function sparklineData(values: number[]): ChartData<"line"> {
  return {
    labels: values.map((_, index) => String(index + 1)),
    datasets: [
      {
        data: values,
        borderColor: "var(--main-color)",
        backgroundColor: "transparent",
      },
    ],
  };
}
