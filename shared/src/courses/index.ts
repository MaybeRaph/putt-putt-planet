import { CourseSchema, type Course, type CourseInput } from '../schema';
import { meadow } from './meadow';
import { candy } from './candy';
import { frozen } from './frozen';
import { clockwork } from './clockwork';
import { space } from './space';

const RAW: CourseInput[] = [meadow, candy, frozen, clockwork, space];

/** All courses, validated once at module load. */
export const COURSES: Course[] = RAW.map((c) => CourseSchema.parse(c));

export function getCourse(id: string): Course | undefined {
  return COURSES.find((c) => c.id === id);
}

export { RAW as RAW_COURSES };
