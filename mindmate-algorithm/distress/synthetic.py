"""Reproducible English demo data, with independent phrase families per split.

This corpus exercises the software. Its template-based metrics are not estimates
of performance on real students, and it must never authorize a clinical release.
"""
import csv
import random
from pathlib import Path

from . import LABELS
from .features import normalize


GENERATOR_VERSION = "english-prototype-v2"
FIELDS = ("text", "label", "student_id", "conversation_id", "split", "subgroup", "data_source", "language", "template_family")

# A phrase family appears in exactly one split. Contextual variations never move
# a family across partitions, unlike random row splitting of augmented templates.
PHRASES = {
    "LOW": {
        "train": (
            "I feel good about how my classes are going.",
            "I am a little nervous about my exam, but I am managing it.",
            "I had a difficult morning and feel better after talking to a friend.",
            "Can you suggest a short breathing exercise before class?",
            "I feel supported by my friends and family.",
            "I am tired after studying and plan to rest tonight.",
            "I am proud that I finished a difficult assignment.",
            "I sometimes worry about grades, but I can still enjoy my day.",
            "I want to make a realistic study schedule.",
            "I feel safe and do not want to hurt myself.",
            "I am not thinking about suicide; I want help with exam stress.",
            "Our literature class discussed a fictional character who died by suicide.",
            "A public health assignment asks how suicide prevention services work.",
            "That homework was a killer, but I am joking and doing fine.",
            "I enjoy spending time with my classmates.",
            "I have a lot to do, and taking breaks helps me cope.",
            "I felt disappointed about my grade but know I can improve.",
            "I need advice on balancing hobbies and schoolwork.",
            "I am looking forward to seeing my friends tomorrow.",
            "I have been sleeping well and keeping a normal routine.",
            "My friend mentioned self-harm in a research presentation, not a personal situation.",
            "I do not have any plans to harm myself and feel hopeful.",
            "I would like to learn healthy ways to handle ordinary stress.",
            "A walk helped me calm down after a stressful class.",
            "I don't want to hurt myself; I am safe.",
            "I do not want to kill myself, and I have no intention of suicide.",
            "I am not suicidal and do not plan to harm myself.",
            "I have never wanted to end my life; I am asking about prevention.",
            "I don't intend to injure myself, and I feel safe at home.",
            "I am not going to hurt myself tonight; I want to get some rest.",
            "I have no thoughts of taking my own life and feel supported.",
            "I am safe right now and have no plan to harm myself.",
        ),
        "validation": (
            "I am doing okay and just need help planning my homework.",
            "My stress feels manageable with rest and support.",
            "I feel connected to people and optimistic about this week.",
            "I am safe, and I am not having thoughts of self-harm.",
            "We are analyzing suicide as a theme in a novel for class.",
            "I was anxious about a quiz but relaxed once it was over.",
            "I want to practice a grounding exercise even though I feel fine.",
            "The exam killed me is just an expression; I feel alright.",
        ),
        "test": (
            "I am happy with my progress and want to keep a healthy routine.",
            "A busy week is making me mildly stressed, but I am coping.",
            "I can ask my friends for help when studying feels difficult.",
            "I have no wish to die or hurt myself, and I feel safe.",
            "My essay is about historical suicide prevention campaigns.",
            "I felt upset earlier, but now I feel calm and supported.",
            "Can we brainstorm ways to organize my revision time?",
            "I am excited about my plans after graduation.",
        ),
    },
    "MODERATE": {
        "train": (
            "I have felt anxious most days this week and need someone to listen.",
            "I keep worrying about school even when I try to relax.",
            "I have been feeling lonely and would like some support.",
            "My mood has been low lately, although I still attend my classes.",
            "I am overwhelmed by deadlines and find it hard to concentrate.",
            "I lie awake worrying about whether I will pass my subjects.",
            "I have been crying more often after arguments at home.",
            "I feel tense every day and have trouble settling down.",
            "I am losing motivation and keep putting off my homework.",
            "I feel left out when my classmates make plans without me.",
            "I worry that I am letting everyone down, but I am still trying.",
            "My appetite has changed while I have been under stress.",
            "I feel sad on many days and want to talk to a counselor.",
            "I am struggling to enjoy activities as much as I used to.",
            "I feel burned out and need help finding a better routine.",
            "I often feel insecure and compare myself with other students.",
            "I get nervous before class and sometimes need a break.",
            "My worries keep distracting me from conversations.",
            "I am having a hard time adjusting to college life.",
            "I feel emotionally drained but can still look after myself.",
            "I keep replaying a disagreement and feeling upset about it.",
            "I have been avoiding social events because I feel anxious.",
            "I feel stressed and would like help asking for support.",
            "I feel down and tired, and ordinary tasks take more effort.",
            "My anxiety makes it difficult to concentrate, but I still go to class.",
            "I am having a panic attack and would like help calming down.",
            "I have been stressed for a few days and need to talk about it.",
            "I feel sad after a breakup and would like emotional support.",
            "I feel worried and exhausted by constant pressure to succeed.",
            "I am not enjoying school lately and often feel discouraged.",
            "I keep feeling anxious before presentations and struggle with sleep.",
            "I feel lonely in my dorm and am finding it hard to make friends.",
        ),
        "validation": (
            "My anxiety keeps returning during the day, and I need coping support.",
            "I have felt isolated lately despite attending my usual classes.",
            "I am finding it harder to focus because I worry so much.",
            "I have been sad for several days and would appreciate a conversation.",
            "I feel worn out by expectations but am still keeping up with daily tasks.",
            "I cannot relax easily and have been sleeping poorly from stress.",
            "I feel nervous around other students and tend to stay quiet.",
            "I miss enjoying my hobbies and want help with my low mood.",
        ),
        "test": (
            "I feel anxious again and again, even after the school day ends.",
            "I have been lonely for a while and need someone to talk with.",
            "I keep struggling with concentration and motivation under pressure.",
            "I am feeling sad more often, although I still manage my routine.",
            "I worry about disappointing my teachers and cannot switch off easily.",
            "Stress is affecting my sleep and making me irritable.",
            "I am going through a rough patch and think counseling could help.",
            "I feel emotionally exhausted and need support managing my workload.",
        ),
    },
    "HIGH_CONCERN": {
        "train": (
            "I feel completely hopeless and cannot see a way forward.",
            "I have been unable to get out of bed or attend classes for weeks.",
            "I feel worthless and believe everyone would be better off without me.",
            "Nothing feels meaningful, and I have stopped caring for myself.",
            "I wish I could disappear and never have to face anything again.",
            "I do not want to wake up, but I am not planning to hurt myself.",
            "I cannot manage basic daily tasks because everything feels unbearable.",
            "I have stopped eating properly and barely leave my room.",
            "I feel trapped, hopeless, and cut off from everyone.",
            "I feel like a burden, and I do not know how much longer I can cope.",
            "I think about not existing, although I have no immediate plan to act.",
            "I feel empty every day and have completely withdrawn from my friends.",
            "I have been missing all my classes because I cannot function.",
            "I feel as if my life has no purpose anymore.",
            "I want everything to stop, and I desperately need someone with me.",
            "I am so overwhelmed that I cannot look after myself.",
            "I cannot imagine my future getting any better.",
            "I spend whole days in bed feeling that there is no point in trying.",
            "I feel broken and unable to carry on with my normal life.",
            "I sometimes wish I were dead, but I do not intend to act on it.",
            "I have given up on school and have isolated myself from everyone.",
            "My distress is so intense that I need urgent support from a person.",
            "I feel utterly defeated and unable to meet my basic needs.",
            "I have lost all hope and do not feel able to cope on my own.",
            "I feel like disappearing because I cannot bear my life anymore.",
            "I wish I were no longer alive, but I am not going to act on that thought.",
            "I am not planning suicide, but I feel completely hopeless.",
            "I have no intention to hurt myself right now, but I cannot function.",
            "I feel life is no longer worth living, although I have no immediate plan.",
            "I cannot get out of bed, eat properly, or keep up with any classes.",
            "I feel I am a burden on everyone and desperately need human support.",
            "I have withdrawn entirely and do not know how to keep going.",
        ),
        "validation": (
            "I feel there is no hope left, and I cannot function in daily life.",
            "I have withdrawn from everyone and stopped taking care of myself.",
            "I wish I would not wake up, though I have no plan to do anything.",
            "I feel like a burden and cannot see a reason to keep trying.",
            "I am barely eating or leaving bed because I feel so empty.",
            "My life feels pointless, and I cannot cope without urgent support.",
            "I cannot attend class anymore because the distress is unbearable.",
            "I keep wishing I could vanish without planning to harm myself.",
        ),
        "test": (
            "I see no future for myself and cannot manage ordinary daily life.",
            "I have stopped washing and eating regularly and shut everyone out.",
            "I feel everyone would be better off if I did not exist.",
            "I wish I could go to sleep forever, but I have no immediate intention to act.",
            "I am too overwhelmed to care for myself and need a person to help.",
            "I feel hopeless all the time and have completely stopped attending school.",
            "I feel like giving up on everything because I cannot keep coping alone.",
            "I feel empty and trapped, and nothing in my life seems worth doing.",
        ),
    },
    "IMMEDIATE_SAFETY": {
        "train": (
            "I want to kill myself tonight.",
            "I am going to hurt myself right now.",
            "I have a plan to end my life today.",
            "I cannot keep myself safe from harming myself.",
            "I have already hurt myself and need emergency help.",
            "I am about to act on my thoughts of suicide.",
            "I intend to take my own life this evening.",
            "I have prepared to harm myself and am alone.",
            "I am in immediate danger of hurting myself.",
            "I have decided to end my life and plan to do it soon.",
            "I want to die, and I might act on it in the next hour.",
            "I am actively harming myself and cannot stop.",
            "I need urgent help because I might kill myself.",
            "I do not trust myself to stay safe tonight.",
            "I am saying goodbye because I plan to take my life.",
            "I have taken steps to end my life and need help now.",
            "I want to injure myself, and I have the means with me.",
            "I have made a suicide plan and intend to follow it.",
            "I may hurt myself as soon as I am alone.",
            "I am planning suicide and do not feel safe.",
            "I might end my life before tomorrow.",
            "I am about to hurt myself and need someone to intervene.",
            "I cannot promise I will not harm myself tonight.",
            "I need emergency support to stop myself from taking my life.",
            "I want to hurt myself, and I do not feel able to resist.",
            "I do want to kill myself, and I have decided to act tonight.",
            "I am suicidal and ready to carry out my plan now.",
            "I intend to end my life, and I cannot keep myself safe.",
            "I am not safe right now because I plan to injure myself.",
            "I have thoughts of taking my own life and intend to act soon.",
            "I am going to harm myself tonight and need immediate intervention.",
            "I want emergency help because I have already harmed myself.",
        ),
        "validation": (
            "I intend to end my life tonight and have a plan.",
            "I might seriously hurt myself right now; I am not safe.",
            "I am about to attempt suicide and need immediate help.",
            "I cannot stop myself from harming myself this evening.",
            "I have already acted to hurt myself and need emergency support.",
            "I plan to take my own life before the day ends.",
            "I have the means to harm myself and intend to use them soon.",
            "I do not think I can stay safe from myself for the next hour.",
        ),
        "test": (
            "I am going to end my life in a few hours.",
            "I am at risk of acting on my suicide plan right now.",
            "I need somebody here immediately because I might harm myself.",
            "I have begun hurting myself and need urgent medical help.",
            "I intend to die tonight and have prepared to act.",
            "I cannot keep myself from taking my own life today.",
            "I am about to injure myself and have everything ready.",
            "I do not feel able to stay alive safely tonight.",
        ),
    },
}

CONTEXTS = (
    "I am a university student.",
    "I have been thinking about my classes.",
    "I am writing from my room.",
    "I wanted to share how I feel.",
    "I find it easier to type than to speak.",
    "I want you to understand what is happening.",
    "This is what I need to talk about.",
    "I have a lot on my mind.",
    "I am reaching out through this chat.",
    "I am trying to put my feelings into words.",
)


def generate_rows(seed: int = 42) -> list[dict]:
    """Generate balanced examples; no identifiers are inserted in text."""
    rng = random.Random(seed)
    rows = []
    for split in ("train", "validation", "test"):
        for label in LABELS:
            for family_index, phrase in enumerate(PHRASES[label][split]):
                for variation, context in enumerate(CONTEXTS):
                    # The four classes share pseudonymous students within a split
                    # so every grouped calibration fold can contain every class.
                    student = f"synthetic-{split}-{family_index:03}"
                    text = f"{context} {phrase}" if rng.random() < 0.5 else f"{phrase} {context}"
                    rows.append({"text": text, "label": label, "student_id": student,
                                 "conversation_id": f"{student}-conversation", "split": split,
                                 "subgroup": "synthetic-english", "data_source": "synthetic", "language": "en",
                                 "template_family": f"{GENERATOR_VERSION}:{label}:{split}:{family_index}"})
    rng.shuffle(rows)
    assert len({normalize(row["text"]) for row in rows}) == len(rows)
    return rows


def write_synthetic_dataset(path: Path, seed: int = 42) -> list[dict]:
    rows = generate_rows(seed)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as target:
        writer = csv.DictWriter(target, fieldnames=FIELDS, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    return rows
