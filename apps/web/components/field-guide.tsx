"use client";

import { useMemo, useState } from "react";
import { useGameTheme } from "./theme-provider";

interface GuideAnswer {
  readonly label: string;
  readonly correct?: boolean;
  readonly explanation: string;
}

interface GuideLesson {
  readonly code: string;
  readonly title: string;
  readonly principle: string;
  readonly question: string;
  readonly answers: readonly GuideAnswer[];
}

const lessons: readonly GuideLesson[] = [
  {
    code: "01 // TIMELINE",
    title: "Lower Time acts next",
    principle:
      "Focus pays for power. Time determines priority. After an action, add its Time cost to that player's marker; the lower marker acts next.",
    question: "Your Time is 4 and the rival's is 6. Who has priority?",
    answers: [
      {
        label: "You do",
        correct: true,
        explanation: "Correct. Four is lower than six, so you act next.",
      },
      {
        label: "The rival",
        explanation: "The higher marker is farther ahead, so it waits.",
      },
      {
        label: "Initiative decides",
        explanation:
          "Initiative resolves ties only. These markers are not tied.",
      },
    ],
  },
  {
    code: "02 // FRONTS",
    title: "Presence controls objectives",
    principle:
      "Power wins combat. Presence controls a Front. At Cycle end, control at least two Fronts to gain one Dominion.",
    question: "How do you gain Dominion at Cycle end?",
    answers: [
      {
        label: "Control two Fronts",
        correct: true,
        explanation:
          "Correct. A majority of the three Fronts earns one Dominion.",
      },
      {
        label: "Deal the most damage",
        explanation:
          "Damage pressures Integrity, but Presence decides Front control.",
      },
      {
        label: "Hold the Center only",
        explanation:
          "Center is not special for scoring; you need any two Fronts.",
      },
    ],
  },
  {
    code: "03 // RESPONSES",
    title: "Interaction is deliberately bounded",
    principle:
      "A Main Action allows one defending Response and one acting-player Counter-Response. The chain then resolves backward.",
    question: "What is the longest legal response chain?",
    answers: [
      {
        label: "Action, Response, Counter",
        correct: true,
        explanation:
          "Correct. Three links total; no fourth response can be added.",
      },
      {
        label: "Responses continue freely",
        explanation:
          "TempoFront caps the chain to prevent prolonged priority loops.",
      },
      {
        label: "Only the Main Action",
        explanation:
          "The defender gets one Response window, and the actor may counter it.",
      },
    ],
  },
  {
    code: "04 // VICTORY",
    title: "Pressure the Core and the board",
    principle:
      "Win immediately by reducing the rival Leader to zero Integrity, or score six Dominion through Front control.",
    question: "Which pair contains both normal victory routes?",
    answers: [
      {
        label: "Zero Integrity or six Dominion",
        correct: true,
        explanation:
          "Correct. Damage and objective control are equally real threats.",
      },
      {
        label: "Empty hand or six Dominion",
        explanation: "An empty hand is not a loss condition.",
      },
      {
        label: "Three Fronts or ten Integrity",
        explanation:
          "Control scores Dominion; it does not win instantly at those values.",
      },
    ],
  },
];

export interface FieldGuideResult {
  readonly score: number;
  readonly total: number;
  readonly attempts: number;
}

export function FieldGuide({
  onClose,
  onComplete,
  onStep,
}: {
  readonly onClose: () => void;
  readonly onComplete: (result: FieldGuideResult) => void;
  /** Called when a lesson is passed, with its 1-based number. */
  readonly onStep?: (lesson: number, title: string) => void;
}) {
  const { theme, term } = useGameTheme();
  const themedText = (text: string): string =>
    text
      .replaceAll(
        "TempoFront",
        theme.themeId === "aetherfront" ? "Aetherfront" : "Orbital Conflict",
      )
      .replaceAll("Fronts", `${term("front")}s`)
      .replaceAll("Front", term("front"))
      .replaceAll("Dominion", term("dominion"))
      .replaceAll("Integrity", term("integrity"))
      .replaceAll("Leader", term("leader"))
      .replaceAll("Entity", term("entity"))
      .replaceAll("Focus", term("focus"));
  const [lessonIndex, setLessonIndex] = useState(0);
  const [attempts, setAttempts] = useState(0);
  const [wrongAnswers, setWrongAnswers] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [answered, setAnswered] = useState(false);
  const complete = lessonIndex >= lessons.length;
  const lesson = lessons[Math.min(lessonIndex, lessons.length - 1)];
  const score = useMemo(
    () => Math.max(0, lessons.length - wrongAnswers),
    [wrongAnswers],
  );

  const choose = (answer: GuideAnswer) => {
    setAttempts((value) => value + 1);
    setFeedback(answer.explanation);
    if (answer.correct) setAnswered(true);
    else setWrongAnswers((value) => value + 1);
  };

  const advance = () => {
    onStep?.(lessonIndex + 1, lesson.title);
    if (lessonIndex === lessons.length - 1) {
      const result = { score, total: lessons.length, attempts };
      onComplete(result);
      window.sessionStorage.setItem(
        "cardforge.comprehension.v1",
        JSON.stringify(result),
      );
    }
    setLessonIndex((value) => value + 1);
    setFeedback(null);
    setAnswered(false);
  };

  return (
    <div
      className="field-guide"
      data-guide-step={complete ? "complete" : lessonIndex + 1}
      role="dialog"
      aria-labelledby="field-guide-title"
      aria-describedby="field-guide-description"
      aria-modal="true"
    >
      <div className="field-guide__card">
        <div className="field-guide__header">
          <div>
            <p className="eyebrow">
              {(theme.themeId === "aetherfront"
                ? "AETHERFRONT"
                : "ORBITAL CONFLICT") + " FIELD GUIDE"}
            </p>
            <h2 id="field-guide-title">
              {complete
                ? "Ready for the shared timeline"
                : themedText(lesson.title)}
            </h2>
          </div>
          <button
            aria-label="Close Field Guide"
            className="field-guide__close"
            onClick={onClose}
            type="button"
          >
            SKIP GUIDE
          </button>
        </div>

        {complete ? (
          <div className="field-guide__complete">
            <strong data-guide-score={`${score}/${lessons.length}`}>
              {score}/{lessons.length} concepts cleared
            </strong>
            <p>
              You made {attempts} answer attempt{attempts === 1 ? "" : "s"}. The
              board will preview legal targets and projected Time before you
              commit an action.
            </p>
            <button
              autoFocus
              className="button button--primary field-guide__finish"
              onClick={onClose}
              type="button"
            >
              Enter the match
            </button>
          </div>
        ) : (
          <>
            <div className="field-guide__progress" aria-label="Guide progress">
              {lessons.map((item, index) => (
                <span
                  className={index <= lessonIndex ? "is-active" : ""}
                  key={item.code}
                />
              ))}
            </div>
            <p className="field-guide__code">{themedText(lesson.code)}</p>
            <p id="field-guide-description" className="field-guide__principle">
              {themedText(lesson.principle)}
            </p>
            <fieldset className="field-guide__question">
              <legend>{themedText(lesson.question)}</legend>
              <div className="field-guide__answers">
                {lesson.answers.map((answer) => (
                  <button
                    data-correct={answer.correct ? "true" : "false"}
                    disabled={answered}
                    key={answer.label}
                    onClick={() => choose(answer)}
                    type="button"
                  >
                    {themedText(answer.label)}
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="field-guide__feedback" aria-live="polite">
              {feedback
                ? themedText(feedback)
                : "Choose an answer to test the rule."}
            </div>
            <button
              className="button button--primary field-guide__next"
              disabled={!answered}
              onClick={advance}
              type="button"
            >
              {lessonIndex === lessons.length - 1
                ? "Review result"
                : "Next concept"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
