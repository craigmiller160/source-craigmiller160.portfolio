import path from 'path';
import { google } from 'googleapis';
import fs from 'fs/promises';
import { z } from 'zod';
import type { Position, Resume } from '../resume/resume';
import { match, P } from 'ts-pattern';
import { produce } from 'immer';

const KEYFILE_PATH = path.join(
    process.cwd(),
    'market-tracker-service-account.json'
);
const SCOPES = ['https://www.googleapis.com/auth/drive'];
const FILE_ID = '1sCkcJyAG48F6mRu_gTGp2oEJLFU4NqrMI0w8tLYOiQU';
const OUTPUT_DIR = path.join(import.meta.dirname, '..', 'resume');
const RAW_OUTPUT_FILE = path.join(OUTPUT_DIR, 'my-resume.txt');
const PARSED_OUTPUT_FILE = path.join(OUTPUT_DIR, 'my-resume.json');
const STARTS_WITH_WHITESPACE_REGEX = /^\s+/;
const STARTS_WITH_ASTERISK_REGEX = /^\*/;
const ITEM_AND_DATES_REGEX = /^(?<item>.+)\((?<dates>.+)\)$/;
const ITEM_AND_INSTITUTION_REGEX = /^(?<item>.+), (?<institution>.+)$/;

const itemAndDatesSchema = z
    .object({
        item: z.string(),
        dates: z.string()
    })
    .readonly();

const itemAndInstitutionSchema = z
    .object({
        item: z.string(),
        institution: z.string()
    })
    .readonly();

const BASE_RESUME: Resume = {
    name: '',
    contact: {
        email: ''
    },
    education: [],
    certifications: [],
    experience: [],
    honorsAndAchievements: [],
    intro: {
        body: '',
        title: ''
    },
    skills: {
        agileExperience: [],
        cloudDeployment: [],
        databases: [],
        frameworksAndTools: [],
        languages: []
    }
};

const resumeResponseSchema = z.string();

const auth = new google.auth.GoogleAuth({
    keyFile: KEYFILE_PATH,
    scopes: SCOPES
});

const drive = google.drive({
    version: 'v3',
    auth
});

const downloadResume = async () => {
    // https://developers.google.com/drive/api/guides/ref-export-formats
    const response = await drive.files.export({
        fileId: FILE_ID,
        mimeType: 'text/plain'
    });
    const resumeText = resumeResponseSchema
        .parse(response.data)
        .replace('\r\n', '\n');
    await fs.writeFile(RAW_OUTPUT_FILE, resumeText);

    const parsed = parseResume(resumeText);
    await fs.writeFile(PARSED_OUTPUT_FILE, JSON.stringify(parsed, null, 2));
};

type Skill = keyof Resume['skills'];
type ResumeSection =
    | 'intro'
    | 'experience'
    | 'skills'
    | 'certifications'
    | 'education'
    | 'honors';
type ResumeParsingIntroContext = Readonly<{
    hasMovedPastAddress: boolean;
    hasMovedPastLinks: boolean;
}>;
type ResumeParsingContext = Readonly<{
    resume: Resume;
    section: ResumeSection;
    experienceIndex: number;
    currentSkill: Skill;
    intro: ResumeParsingIntroContext;
}>;

const parseResume = (resumeText: string): Resume => {
    const lines = resumeText.trim().split('\n');
    const startingContext: ResumeParsingContext = {
        resume: BASE_RESUME,
        section: 'intro',
        experienceIndex: 0,
        currentSkill: 'languages',
        intro: {
            hasMovedPastAddress: false,
            hasMovedPastLinks: false
        }
    };

    return (
        lines
            .filter((line) => !!line.trim())
            // The use of this reducer plus the immutable design patterns does result in an O(n^2) algorithm
            // Given the small size of the dataset, plus the infrequency of its execution, this is an acceptable tradeoff for the clean algorithm
            .reduce(parseLine, startingContext).resume
    );
};

const parseLine = (
    context: ResumeParsingContext,
    line: string
): ResumeParsingContext =>
    match(context.section)
        .with('intro', () => parseIntroLine(context, line))
        .with('experience', () => parseExperienceLine(context, line))
        .with('skills', () => parseSkillLine(context, line))
        .with('certifications', () => parseCertificationsLine(context, line))
        .with('education', () => parseEducationLine(context, line))
        .with('honors', () => parseHonorsLine(context, line))
        .exhaustive();

const isEmpty = (array: ReadonlyArray<string>): boolean => array.length === 0;

const parseSkillLine = (
    context: ResumeParsingContext,
    line: string
): ResumeParsingContext => {
    if (
        [
            'Languages',
            'Frameworks/Tools',
            'Databases/MQs',
            'Cloud Deployment',
            'Agile Experience'
        ].includes(line.trim())
    ) {
        return context;
    }

    if ('Certifications' === line.trim()) {
        return produce(context, (draft) => {
            draft.section = 'certifications';
        });
    }

    const startsWithWhitespace = STARTS_WITH_WHITESPACE_REGEX.test(line);

    const skill = line.trim().replace(STARTS_WITH_ASTERISK_REGEX, '').trim();

    const currentSkill = match<
        { startsWithWhitespace: boolean; skills: Resume['skills'] },
        Skill
    >({
        skills: context.resume.skills,
        startsWithWhitespace
    })
        .with(
            {
                startsWithWhitespace: true,
                skills: { languages: P.when(isEmpty) }
            },
            () => 'languages'
        )
        .with(
            {
                startsWithWhitespace: true,
                skills: { frameworksAndTools: P.when(isEmpty) }
            },
            () => 'frameworksAndTools'
        )
        .with(
            {
                startsWithWhitespace: true,
                skills: { databases: P.when(isEmpty) }
            },
            () => 'databases'
        )
        .with(
            {
                startsWithWhitespace: true,
                skills: { cloudDeployment: P.when(isEmpty) }
            },
            () => 'cloudDeployment'
        )
        .with(
            {
                startsWithWhitespace: true,
                skills: { agileExperience: P.when(isEmpty) }
            },
            () => 'agileExperience'
        )
        .otherwise(() => context.currentSkill);

    return produce(context, (draft) => {
        draft.resume.skills[currentSkill].push(skill);
        draft.currentSkill = currentSkill;
    });
};

const parseExperienceLine = (
    context: ResumeParsingContext,
    line: string
): ResumeParsingContext => {
    if ('Technical Knowledge' === line.trim()) {
        return produce(context, (draft) => {
            draft.section = 'skills';
        });
    }

    const hasExperience = context.resume.experience.length > 0;
    const currentExperienceHasAchievements =
        context.resume.experience[context.experienceIndex]?.achievements
            ?.length > 0;
    const isOpeningExperienceLine =
        !STARTS_WITH_WHITESPACE_REGEX.test(line) &&
        !STARTS_WITH_ASTERISK_REGEX.test(line.trim());
    const isPositionsLine =
        STARTS_WITH_WHITESPACE_REGEX.test(line) &&
        !STARTS_WITH_ASTERISK_REGEX.test(line.trim());

    if (
        isOpeningExperienceLine &&
        (currentExperienceHasAchievements || !hasExperience)
    ) {
        const newExperienceIndex = currentExperienceHasAchievements
            ? context.experienceIndex + 1
            : context.experienceIndex;
        return produce(context, (draft) => {
            draft.experienceIndex = newExperienceIndex;
            draft.resume.experience[newExperienceIndex] = {
                achievements: [],
                company: line.trim(),
                dates: '',
                positions: []
            };
        });
    }

    if (isPositionsLine) {
        const positions = line
            .trim()
            .split(',')
            .map((text) => ITEM_AND_DATES_REGEX.exec(text.trim())?.groups)
            .map((groups) => itemAndDatesSchema.parse(groups))
            .map(
                ({ item, dates }): Position => ({
                    title: item,
                    dates
                })
            );
        return produce(context, (draft) => {
            draft.resume.experience[draft.experienceIndex].positions =
                positions;
        });
    }

    if (STARTS_WITH_ASTERISK_REGEX.test(line)) {
        return produce(context, (draft) => {
            draft.resume.experience[draft.experienceIndex].achievements.push(
                line.replace(STARTS_WITH_ASTERISK_REGEX, '').trim()
            );
        });
    }

    return context;
};

const parseIntroLine = (
    context: ResumeParsingContext,
    line: string
): ResumeParsingContext => {
    if (!context.resume.name) {
        return produce(context, (draft) => {
            draft.resume.name = line.trim();
        });
    }

    const noWhitespaceLineAfterName =
        !STARTS_WITH_WHITESPACE_REGEX.test(line) &&
        !!context.resume.name &&
        !context.resume.contact.email;

    if (noWhitespaceLineAfterName && context.intro.hasMovedPastAddress) {
        return produce(context, (draft) => {
            draft.resume.contact.email = line.trim();
        });
    }

    if (noWhitespaceLineAfterName) {
        return produce(context, (draft) => {
            draft.intro.hasMovedPastAddress = true;
        });
    }

    const noWhitespaceAfterEmail =
        !STARTS_WITH_WHITESPACE_REGEX.test(line) &&
        !!context.resume.contact.email &&
        !context.resume.intro.title;

    if (noWhitespaceAfterEmail && context.intro.hasMovedPastLinks) {
        return produce(context, (draft) => {
            draft.resume.intro.title = line.trim();
        });
    }

    if (noWhitespaceAfterEmail) {
        return produce(context, (draft) => {
            draft.intro.hasMovedPastLinks = true;
        });
    }

    if ('Industry Experience' === line.trim()) {
        return produce(context, (draft) => {
            draft.section = 'experience';
        });
    }

    if (context.resume.intro.title) {
        return produce(context, (draft) => {
            draft.resume.intro.body = line.trim();
        });
    }

    return context;
};

const parseCertificationsLine = (
    context: ResumeParsingContext,
    line: string
): ResumeParsingContext => {
    if ('Education' === line.trim()) {
        return produce(context, (draft) => {
            draft.section = 'education';
        });
    }

    return produce(context, (draft) => {
        draft.resume.certifications.push(
            line.trim().replace(STARTS_WITH_ASTERISK_REGEX, '').trim()
        );
    });
};

const parseEducationLine = (context: ResumeParsingContext, line: string) => {
    if ('Honors & Achievements' === line.trim()) {
        return produce(context, (draft) => {
            draft.section = 'honors';
        });
    }

    const cleanedEducationLine = line
        .trim()
        .replace(STARTS_WITH_ASTERISK_REGEX, '')
        .trim();
    const groups =
        ITEM_AND_INSTITUTION_REGEX.exec(cleanedEducationLine)?.groups;
    if (!groups) {
        throw new Error(`Invalid education line format: ${groups}`);
    }
    const { item, institution } = itemAndInstitutionSchema.parse(groups);

    return produce(context, (draft) => {
        draft.resume.education.push({
            degree: item,
            institution
        });
    });
};

const parseHonorsLine = (
    context: ResumeParsingContext,
    line: string
): ResumeParsingContext => {
    if ('Honors & Achievements' === line.trim()) {
        return context;
    }

    const cleanedHonorsLine = line
        .trim()
        .replace(STARTS_WITH_ASTERISK_REGEX, '')
        .trim();
    const groups = ITEM_AND_INSTITUTION_REGEX.exec(cleanedHonorsLine)?.groups;
    if (!groups) {
        throw new Error(`Invalid education line format: ${groups}`);
    }
    const { item, institution } = itemAndInstitutionSchema.parse(groups);

    return produce(context, (draft) => {
        draft.resume.honorsAndAchievements.push({
            honor: item,
            institution
        });
    });
};

downloadResume().catch((ex) => console.error(ex));
