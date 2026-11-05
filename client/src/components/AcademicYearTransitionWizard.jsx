import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, ArrowRight, Check, LoaderCircle, Plus, X } from 'lucide-react';
import { api } from '../services/api.js';
import { apiRoutes } from '../services/apiRoutes.js';
import { ErrorPanel, SearchableSelect } from './ui.jsx';

const steps = [
  'New year', 'Template', 'Classes', 'Promotion', 'Homerooms',
  'Grade & classes', 'Teachers & schedules', 'Terms & grading', 'Review'
];
const promotionStatuses = ['Promoted', 'Conditional Promotion', 'Retained/Repeat', 'Graduated', 'Transferred', 'Pending'];
const subjectOutcomes = ['Pass', 'Fail', 'Incomplete', 'Not Assessed'];
const promotionStatusOptions = promotionStatuses.map(status => ({ id: status, name: status }));
const subjectOutcomeOptions = subjectOutcomes.map(outcome => ({ id: outcome, name: outcome }));
const weekDayOptions = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
  .map((name, index) => ({ id: String(index + 1), name }));
function movedDate(value, offset) {
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function academicYearName(startDate, endDate) {
  if (!startDate || !endDate) return '';
  return `${startDate.slice(0, 4)}-${endDate.slice(0, 4)}`;
}

function getNextGradeLevel(gradeLevel, gradeLevels) {
  const match = gradeLevel.match(/^Grade\s*(K|\d+)$/i);
  if (!match) return gradeLevel;
  const current = match[1].toUpperCase() === 'K' ? 0 : Number(match[1]);
  if (current >= 12) return gradeLevel;
  const next = `Grade ${current + 1}`;
  return gradeLevels.find(level => level.toLowerCase() === next.toLowerCase()) || gradeLevel;
}

function advanceClassName(name, sourceGrade, targetGrade) {
  const source = sourceGrade.match(/^Grade\s*(K|\d+)$/i);
  const target = targetGrade.match(/^Grade\s*(K|\d+)$/i);
  if (!source || !target || source[1].toLowerCase() === target[1].toLowerCase()) return name;
  const sourceToken = source[1];
  const targetToken = target[1];
  const tokenPattern = sourceToken.toUpperCase() === 'K'
    ? 'K(?=[A-Za-z]?(?:[-_/\\s]|$))'
    : `${sourceToken}(?=\\D|$)`;
  const pattern = new RegExp(`(\\bgrade\\s*|\\b)${tokenPattern}`, 'i');
  return name.replace(pattern, (_, prefix = '') => `${prefix}${targetToken}`);
}

function dateOffset(from, to) {
  if (!from || !to) return 0;
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${String(from).slice(0, 10)}T00:00:00Z`)) / 86400000);
}

function termDateIssue(term, year) {
  if (!term.start_date || !term.end_date) return 'Enter both term dates.';
  if (term.end_date < term.start_date) return 'The end date must be on or after the start date.';
  if (year.start_date && term.start_date < year.start_date) return `Starts before the academic year (${year.start_date}).`;
  if (year.end_date && term.end_date > year.end_date) return `Ends after the academic year (${year.end_date}).`;
  return '';
}

function timeOverlaps(first, second) {
  return first.day_of_week === second.day_of_week &&
    String(first.start_time).slice(0, 5) < String(second.end_time).slice(0, 5) &&
    String(first.end_time).slice(0, 5) > String(second.start_time).slice(0, 5);
}

function Card({ children, className = '' }) {
  return <div className={`rounded-xl border border-slate-200 bg-white p-4 ${className}`}>{children}</div>;
}

export default function AcademicYearTransitionWizard({ academicYears, currentYearId, onClose, onComplete }) {
  const [step, setStep] = useState(0);
  const [year, setYear] = useState({ name: '', start_date: '', end_date: '' });
  const [yearTouched, setYearTouched] = useState({ name: false, start_date: false, end_date: false });
  const yearStartDateRef = useRef(year.start_date);
  yearStartDateRef.current = year.start_date;
  const [sourceYearId, setSourceYearId] = useState(String(currentYearId || ''));
  const [options, setOptions] = useState(null);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [optionsError, setOptionsError] = useState('');
  const [copy, setCopy] = useState({
    classes: true, terms: true, grading_scales: true, teacher_assignments: true, class_schedules: true
  });
  const [classes, setClasses] = useState([]);
  const [terms, setTerms] = useState([]);
  const [teacherAssignments, setTeacherAssignments] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [promotions, setPromotions] = useState({});
  const [outcomes, setOutcomes] = useState({});
  const [selectedStudents, setSelectedStudents] = useState([]);
  const [studentSearch, setStudentSearch] = useState('');
  const [studentGradeFilter, setStudentGradeFilter] = useState('');
  const [studentClassFilter, setStudentClassFilter] = useState('');
  const [classChoice, setClassChoice] = useState({});
  const [enrollmentStudentFilter, setEnrollmentStudentFilter] = useState('');
  const [activateYear, setActivateYear] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(null);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (!toast) return undefined;
    const timeout = setTimeout(() => setToast(null), 500);
    return () => clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (step !== 7 || !copy.terms) return;
    const invalidTerm = terms.find(term => termDateIssue(term, year));
    if (invalidTerm) {
      const issue = termDateIssue(invalidTerm, year);
      setToast({ message: `${invalidTerm.name.trim() || 'Term'}: ${issue}` });
    }
  }, [step, copy.terms, terms, year.start_date, year.end_date]);

  useEffect(() => {
    if (!sourceYearId) {
      setOptions(null);
      setClasses([]);
      setTerms([]);
      setTeacherAssignments([]);
      setSchedules([]);
      setPromotions({});
      setOutcomes({});
      setSelectedStudents([]);
      setClassChoice({});
      return undefined;
    }
    const controller = new AbortController();
    setOptionsLoading(true);
    setOptionsError('');
    api(`${apiRoutes.academicYears.transitionOptions}?source_year_id=${encodeURIComponent(sourceYearId)}`, {
      signal: controller.signal
    }).then(data => {
      if (controller.signal.aborted) return;
      setOptions(data);
      setStudentGradeFilter('');
      setStudentClassFilter('');
      setClassChoice({});
      setEnrollmentStudentFilter('');
      const shift = dateOffset(data.source_year?.start_date, yearStartDateRef.current);
      setClasses(copy.classes ? data.classes.map(row => {
        const nextGrade = getNextGradeLevel(row.grade_level, data.grade_levels || []);
        return {
          source_class_id: row.id,
          template_class_id: row.id,
          name: advanceClassName(row.name, row.grade_level, nextGrade),
          grade_level: nextGrade,
          capacity: row.capacity,
          homeroom_teacher_id: row.homeroom_teacher_id || ''
        };
      }) : []);
      setTerms(data.terms.map(row => ({
        source_term_id: row.id,
        name: row.name,
        start_date: movedDate(row.start_date, shift),
        end_date: movedDate(row.end_date, shift)
      })));
      setTeacherAssignments(copy.classes ? data.teacher_assignments.map(row => ({
        class_source_id: row.class_id,
        subject_id: row.subject_id,
        teacher_id: row.teacher_id
      })) : []);
      setSchedules(copy.classes ? data.schedules.map(row => ({
        class_source_id: row.class_id,
        subject_id: row.subject_id,
        teacher_id: row.teacher_id,
        day_of_week: row.day_of_week,
        start_time: String(row.start_time).slice(0, 5),
        end_time: String(row.end_time).slice(0, 5),
        room: row.room || ''
      })) : []);
      const nextPromotions = Object.fromEntries(data.students.map(student => [student.id, {
        promotion_status: 'Promoted',
        homeroom_class_source_id: copy.classes ? student.class_id : '',
        class_enrollments: copy.classes ? [...new Set(data.subject_enrollments
          .filter(enrollment => enrollment.student_id === student.id)
          .map(enrollment => enrollment.class_id)
          .filter(classId => classId !== student.class_id))] : []
      }]));
      setPromotions(nextPromotions);
      setSelectedStudents(data.students.map(student => student.id));
      setOutcomes(Object.fromEntries(data.subject_enrollments.map(enrollment => [
        `${enrollment.student_id}:${enrollment.class_id}:${enrollment.subject_id}`,
        { student_id: enrollment.student_id, class_source_id: enrollment.class_id,
          subject_id: enrollment.subject_id, outcome: 'Not Assessed' }
      ])));
    }).catch(loadError => {
      if (!controller.signal.aborted) setOptionsError(loadError.message);
    }).finally(() => {
      if (!controller.signal.aborted) setOptionsLoading(false);
    });
    return () => controller.abort();
  }, [sourceYearId]);

  const selectedIds = useMemo(() => new Set(selectedStudents), [selectedStudents]);
  const selectedPromotions = useMemo(
    () => selectedStudents.map(id => promotions[id]).filter(Boolean),
    [promotions, selectedStudents]
  );
  const filteredStudents = useMemo(() => {
    const search = studentSearch.trim().toLowerCase();
    return (options?.students || []).filter(student => {
      const matchesSearch = !search ||
        `${student.english_name} ${student.khmer_name || ''} ${student.student_code} ${student.class_name} ${student.grade_level}`
          .toLowerCase().includes(search);
      return matchesSearch &&
        (!studentGradeFilter || student.grade_level === studentGradeFilter) &&
        (!studentClassFilter || student.class_id === studentClassFilter);
    });
  }, [options?.students, studentSearch, studentGradeFilter, studentClassFilter]);
  const selectedFilteredStudents = useMemo(
    () => filteredStudents.filter(student => selectedIds.has(student.id)),
    [filteredStudents, selectedIds]
  );
  const sourceClassById = useMemo(() => new Map((options?.classes || []).map(row => [row.id, row])), [options?.classes]);
  const configuredClassById = useMemo(() => new Map(classes.map(row => [row.source_class_id, row])), [classes]);
  const configuredClassOptions = useMemo(() => classes.map(row => ({
    id: row.source_class_id,
    name: `${row.grade_level} · ${row.name}`,
    searchText: `${row.grade_level} ${row.name}`
  })), [classes]);
  const gradeLevelOptions = options?.grade_levels || [];
  const studentGradeOptions = useMemo(() => gradeLevelOptions.map(level => ({ id: level, name: level })), [gradeLevelOptions]);
  const classSubjectCounts = useMemo(() => {
    const counts = new Map();
    for (const assignment of teacherAssignments) {
      counts.set(assignment.class_source_id, (counts.get(assignment.class_source_id) || 0) + 1);
    }
    return counts;
  }, [teacherAssignments]);
  const studentEnrollmentClassOptions = useMemo(() => classes.map(classRow => ({
    id: classRow.source_class_id,
    name: `${classRow.grade_level} · ${classRow.name}`,
    searchText: `${classRow.grade_level} ${classRow.name}`,
    subjectCount: classSubjectCounts.get(classRow.source_class_id) || 0
  })), [classes, classSubjectCounts]);
  const studentClassOptions = useMemo(() => (options?.classes || []).map(classRow => ({
    id: classRow.id,
    name: `${classRow.grade_level} · ${classRow.name}`,
    searchText: `${classRow.grade_level} ${classRow.name}`
  })), [options?.classes]);
  const enrollmentStudentOptions = useMemo(() => selectedStudents
    .map(studentId => options?.students.find(student => student.id === studentId))
    .filter(student => student && ['Promoted', 'Conditional Promotion', 'Retained/Repeat'].includes(
      promotions[student.id]?.promotion_status
    ))
    .map(student => ({
      id: student.id,
      name: student.english_name,
      searchText: `${student.english_name} ${student.khmer_name || ''} ${student.student_code} ${student.grade_level} ${student.class_name}`
    })), [selectedStudents, options?.students, promotions]);
  const studentSearchSuggestions = useMemo(() => (options?.students || []).map(student =>
    `${student.english_name} · ${student.student_code} · ${student.grade_level} · ${student.class_name}`
  ), [options?.students]);
  const studentScheduleConflicts = useMemo(() => {
    const found = [];
    for (const studentId of selectedStudents) {
      const enrolledClasses = promotions[studentId]?.class_enrollments || [];
      const scheduleRows = schedules.filter(schedule =>
        enrolledClasses.includes(schedule.class_source_id)
      );
      for (let first = 0; first < scheduleRows.length; first += 1) {
        for (let second = first + 1; second < scheduleRows.length; second += 1) {
          if (timeOverlaps(scheduleRows[first], scheduleRows[second])) {
            const student = options.students.find(row => row.id === studentId);
            found.push(`${student?.english_name || studentId}: ${scheduleRows[first].subject_name} and ${scheduleRows[second].subject_name}`);
          }
        }
      }
    }
    return [...new Set(found)];
  }, [options, promotions, schedules, selectedStudents]);
  const scheduleConflicts = useMemo(() => {
    const found = [];
    for (let first = 0; first < schedules.length; first += 1) {
      for (let second = first + 1; second < schedules.length; second += 1) {
        const one = schedules[first];
        const two = schedules[second];
        if (!timeOverlaps(one, two)) continue;
        if (one.class_source_id === two.class_source_id || one.teacher_id === two.teacher_id ||
            (one.room && one.room.toLowerCase() === two.room?.toLowerCase())) {
          found.push(`${classes.find(row => row.source_class_id === one.class_source_id)?.name || 'Class'} / ${classes.find(row => row.source_class_id === two.class_source_id)?.name || 'Class'} · ${one.start_time}–${one.end_time}`);
        }
      }
    }
    return [...new Set(found)];
  }, [classes, schedules]);

  function updatePromotion(studentId, patch) {
    setPromotions(previous => {
      const current = previous[studentId] || {};
      const next = { ...current, ...patch };
      if (Object.hasOwn(patch, 'homeroom_class_source_id') && !Object.hasOwn(patch, 'class_enrollments')) {
        next.class_enrollments = (current.class_enrollments || []).filter(
          classId => classId !== patch.homeroom_class_source_id
        );
      }
      return { ...previous, [studentId]: next };
    });
  }

  function toggleStudent(studentId) {
    setSelectedStudents(previous => previous.includes(studentId)
      ? previous.filter(id => id !== studentId)
      : [...previous, studentId]);
  }

  function toggleVisibleStudents() {
    const visibleIds = filteredStudents.map(student => student.id);
    const allSelected = visibleIds.every(id => selectedIds.has(id));
    setSelectedStudents(previous => allSelected
      ? previous.filter(id => !visibleIds.includes(id))
      : [...new Set([...previous, ...visibleIds])]);
  }

  function updateClassEnrollment(studentId, classId, adding) {
    const current = promotions[studentId]?.class_enrollments || [];
    const homeroomClassId = promotions[studentId]?.homeroom_class_source_id;
    const next = adding
      ? classId === homeroomClassId ? current : [...new Set([...current, classId])]
      : current.filter(id => id !== classId);
    updatePromotion(studentId, { class_enrollments: next });
  }

  function getPromotionError() {
    for (const studentId of selectedStudents) {
      const promotion = promotions[studentId];
      if (!promotion) return 'Wait for the student template to finish loading.';
      const needsEnrollment = ['Promoted', 'Conditional Promotion', 'Retained/Repeat'].includes(promotion.promotion_status);
      if (needsEnrollment && !classes.length) {
        return 'Add or copy at least one class before assigning promoted students.';
      }
      if (needsEnrollment && step >= 4 && !promotion.homeroom_class_source_id) {
        return 'Each promoted, conditional, or retained student needs a homeroom class.';
      }
      if (!needsEnrollment && (promotion.homeroom_class_source_id || promotion.class_enrollments.length)) {
        return `${promotion.promotion_status} students cannot receive new enrollments.`;
      }
      if (promotion.class_enrollments.some(classId => !configuredClassById.has(classId))) {
        return 'Class enrollments must use classes configured for the new year.';
      }
      if (step >= 7 && promotion.class_enrollments.some(classId => !classSubjectCounts.get(classId))) {
        return 'Assign at least one subject and teacher to each selected class in Teachers & schedules.';
      }
    }
    return '';
  }

  function getYearFieldErrors() {
    const name = year.name.trim();
    return {
      name: !name
        ? 'Enter an academic year name.'
        : academicYears.some(existing => existing.name.trim().toLowerCase() === name.toLowerCase())
          ? 'An academic year with this name already exists.'
          : '',
      start_date: year.start_date ? '' : 'Choose a start date.',
      end_date: !year.end_date
        ? 'Choose an end date.'
        : year.start_date && year.end_date <= year.start_date
          ? 'End date must be after the start date.'
          : ''
    };
  }

  function validateStep() {
    if (step === 0) {
      const fieldErrors = getYearFieldErrors();
      if (fieldErrors.name || fieldErrors.start_date || fieldErrors.end_date) {
        return fieldErrors.name || fieldErrors.start_date || fieldErrors.end_date;
      }
    }
    if (step === 1 && !sourceYearId) return 'Choose a previous academic year as the template.';
    if (step === 2) {
      if (classes.some(row => !row.name.trim() || !gradeLevelOptions.includes(row.grade_level) ||
          !Number.isInteger(Number(row.capacity)) || Number(row.capacity) < 1 || Number(row.capacity) > 500)) {
        return 'Complete each class name, configured grade level, and capacity (1–500).';
      }
      if (new Set(classes.map(row => row.name.trim().toLowerCase())).size !== classes.length) {
        return 'Class names must be unique for the new year.';
      }
    }
    if ((step === 2 || step === 3 || step === 4 || step === 5 || step === 6 || step === 7) && optionsLoading) {
      return 'Wait for the selected year template to finish loading.';
    }
    if (step >= 3) {
      const promotionError = getPromotionError();
      if (promotionError) return promotionError;
    }
    if (step === 4 && selectedStudents.some(id =>
      ['Promoted', 'Conditional Promotion', 'Retained/Repeat'].includes(promotions[id]?.promotion_status) &&
      !promotions[id]?.homeroom_class_source_id
    )) return 'Assign a homeroom to each promoted student.';
    if (step === 7 && copy.terms) {
      const invalidTerm = terms.find(term => !term.name.trim() || termDateIssue(term, year));
      if (invalidTerm) {
        const issue = termDateIssue(invalidTerm, year) || 'Enter a term name.';
        return `${invalidTerm.name.trim() || 'Term'}: ${issue}`;
      }
      if (new Set(terms.map(term => term.name.trim().toLowerCase())).size !== terms.length) {
        return 'Term names must be unique.';
      }
    }
    if (step === 6 && scheduleConflicts.length) {
      return 'Resolve teacher, class, and classroom timetable conflicts before continuing.';
    }
    if (step === 6) {
      const assignmentKeys = teacherAssignments.map(row =>
        `${row.class_source_id}:${row.subject_id}:${row.teacher_id}`);
      if (new Set(assignmentKeys).size !== assignmentKeys.length) return 'Remove duplicate teacher assignments.';
      if (copy.class_schedules && schedules.some(row =>
        !row.start_time || !row.end_time || row.end_time <= row.start_time ||
        !assignmentKeys.includes(`${row.class_source_id}:${row.subject_id}:${row.teacher_id}`)
      )) return 'Each schedule needs valid times and a matching teacher assignment.';
    }
    return '';
  }

  async function submitTransition() {
    const validationError = validateStep();
    if (validationError) {
      setError(validationError);
      return;
    }
    if (studentScheduleConflicts.length) {
      setError('Resolve the student timetable overlaps shown in the review before completing the transition.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await api(apiRoutes.academicYears.transition, {
        method: 'POST',
        body: JSON.stringify({
          source_year_id: sourceYearId || null,
          year,
          copy,
          classes,
          terms: copy.terms ? terms : [],
          teacher_assignments: copy.teacher_assignments ? teacherAssignments : [],
          schedules: copy.class_schedules ? schedules : [],
          promotions: selectedStudents.map(studentId => ({
            student_id: studentId,
            ...promotions[studentId]
          })),
          subject_outcomes: Object.values(outcomes).filter(outcome => selectedIds.has(outcome.student_id)),
          activate_year: activateYear
        })
      });
      setSuccess(result);
      onComplete(result);
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setBusy(false);
    }
  }

  function nextStep() {
    if (step === 0) setYearTouched({ name: true, start_date: true, end_date: true });
    const validationError = validateStep();
    if (validationError) {
      if (step === 7 && copy.terms) {
        setError('');
        setToast({ message: validationError });
      } else {
        setError(validationError);
      }
      return;
    }
    setError('');
    setStep(previous => Math.min(previous + 1, steps.length - 1));
  }

  function updateClass(index, key, value) {
    setClasses(previous => previous.map((row, rowIndex) => rowIndex === index
      ? { ...row, [key]: value } : row));
  }

  function setClassCopyMode(enabled) {
    setCopy(previous => ({ ...previous, classes: enabled }));
    if (!enabled) {
      const remainingIds = new Set(classes.filter(row => !row.template_class_id).map(row => row.source_class_id));
      setClasses(previous => previous.filter(row => !row.template_class_id));
      setTeacherAssignments(previous => previous.filter(row => remainingIds.has(row.class_source_id)));
      setSchedules(previous => previous.filter(row => remainingIds.has(row.class_source_id)));
      setPromotions(previous => Object.fromEntries(Object.entries(previous).map(([studentId, promotion]) => [
        studentId,
        {
          ...promotion,
          homeroom_class_source_id: remainingIds.has(promotion.homeroom_class_source_id)
            ? promotion.homeroom_class_source_id : '',
          class_enrollments: promotion.class_enrollments.filter(classId => remainingIds.has(classId))
        }
      ])));
      return;
    }
    if (!options) return;
    const copiedClasses = options.classes.map(row => {
      const nextGrade = getNextGradeLevel(row.grade_level, options.grade_levels || []);
      return {
        source_class_id: row.id,
        template_class_id: row.id,
        name: advanceClassName(row.name, row.grade_level, nextGrade),
        grade_level: nextGrade,
        capacity: row.capacity,
        homeroom_teacher_id: row.homeroom_teacher_id || ''
      };
    });
    const copiedClassIds = new Set(copiedClasses.map(row => row.source_class_id));
    setClasses(previous => [
      ...copiedClasses,
      ...previous.filter(row => !row.template_class_id)
    ]);
    setTeacherAssignments(previous => [
      ...options.teacher_assignments.map(row => ({
      class_source_id: row.class_id, subject_id: row.subject_id, teacher_id: row.teacher_id
      })),
      ...previous.filter(row => !copiedClassIds.has(row.class_source_id))
    ]);
    setSchedules(previous => [
      ...options.schedules.map(row => ({
      class_source_id: row.class_id,
      subject_id: row.subject_id,
      teacher_id: row.teacher_id,
      day_of_week: row.day_of_week,
      start_time: String(row.start_time).slice(0, 5),
      end_time: String(row.end_time).slice(0, 5),
      room: row.room || ''
      })),
      ...previous.filter(row => !copiedClassIds.has(row.class_source_id))
    ]);
    setPromotions(previous => Object.fromEntries(options.students.map(student => [
      student.id,
      {
        ...previous[student.id],
        homeroom_class_source_id: student.class_id || previous[student.id]?.homeroom_class_source_id || '',
        class_enrollments: [...new Set(options.subject_enrollments
          .filter(enrollment => enrollment.student_id === student.id)
          .map(enrollment => enrollment.class_id)
          .filter(classId => classId !== student.class_id)
          .concat(previous[student.id]?.class_enrollments.filter(classId => !copiedClassIds.has(classId)) || []))]
      }
    ])));
  }

  function addClass() {
    setClasses(previous => [...previous, {
      source_class_id: crypto.randomUUID(),
      template_class_id: null,
      name: '',
      grade_level: gradeLevelOptions[0] || '',
      capacity: 40,
      homeroom_teacher_id: ''
    }]);
  }

  function removeClass(index) {
    const removed = classes[index];
    if (!removed) return;
    setClasses(previous => previous.filter((_, rowIndex) => rowIndex !== index));
    setTeacherAssignments(previous => previous.filter(row => row.class_source_id !== removed.source_class_id));
    setSchedules(previous => previous.filter(row => row.class_source_id !== removed.source_class_id));
    setPromotions(previous => Object.fromEntries(Object.entries(previous).map(([studentId, promotion]) => [
      studentId,
      {
        ...promotion,
        homeroom_class_source_id: promotion.homeroom_class_source_id === removed.source_class_id
          ? '' : promotion.homeroom_class_source_id,
        class_enrollments: promotion.class_enrollments.filter(classId => classId !== removed.source_class_id)
      }
    ])));
  }

  function updateYearStartDate(value) {
    const shift = dateOffset(options?.source_year?.start_date, value);
    setYear(previous => ({
      ...previous,
      start_date: value,
      name: academicYearName(value, previous.end_date)
    }));
    setError('');
    if (!options) return;
    setTerms(options.terms.map(term => ({
      source_term_id: term.id,
      name: term.name,
      start_date: movedDate(term.start_date, shift),
      end_date: movedDate(term.end_date, shift)
    })));
  }

  function updateTerm(index, key, value) {
    setError('');
    setTerms(previous => previous.map((row, rowIndex) => rowIndex === index
      ? { ...row, [key]: value } : row));
  }

  function updateAssignment(index, key, value) {
    setTeacherAssignments(previous => previous.map((row, rowIndex) => rowIndex === index
      ? { ...row, [key]: value } : row));
  }

  function updateSchedule(index, key, value) {
    setSchedules(previous => previous.map((row, rowIndex) => rowIndex === index
      ? { ...row, [key]: value } : row));
  }

  function removeAssignment(index) {
    const removed = teacherAssignments[index];
    setTeacherAssignments(previous => previous.filter((_, rowIndex) => rowIndex !== index));
    setSchedules(previous => previous.filter(schedule =>
      schedule.class_source_id !== removed.class_source_id ||
      schedule.subject_id !== removed.subject_id ||
      schedule.teacher_id !== removed.teacher_id
    ));
  }

  function addTeacherAssignment() {
    if (!classes.length || !options?.subjects.length || !options?.teachers.length) return;
    setTeacherAssignments(previous => [...previous, {
      class_source_id: classes[0].source_class_id,
      subject_id: options.subjects[0].id,
      teacher_id: options.teachers[0].id
    }]);
  }

  function addSchedule() {
    if (!teacherAssignments.length) return;
    const assignment = teacherAssignments[0];
    setSchedules(previous => [...previous, {
      ...assignment, day_of_week: 1, start_time: '08:00', end_time: '09:00', room: ''
    }]);
  }

  const currentStudent = student => promotions[student.id] || {
    promotion_status: 'Promoted', homeroom_class_source_id: student.class_id, class_enrollments: []
  };
  const yearFieldErrors = getYearFieldErrors();
  const yearValidationMessage = error === yearFieldErrors.name ||
    error === yearFieldErrors.start_date || error === yearFieldErrors.end_date;

  return <section className="space-y-4" aria-labelledby="transition-title">
    {toast && <div role="alert" aria-live="assertive"
      className="fixed right-4 top-4 z-[110] max-w-md rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800 shadow-lg">
      {toast.message}
    </div>}
    <div className="flex min-h-[70vh] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 bg-white px-4 py-4 sm:px-6">
        <div>
          <button type="button" onClick={onClose} disabled={busy} className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-blue-700 hover:text-blue-900 disabled:opacity-50"><ArrowLeft size={16} /> Back to academic years</button>
          <p className="text-xs font-bold uppercase tracking-wider text-blue-700">Academic year setup</p>
          <h2 id="transition-title" className="mt-1 text-xl font-bold text-slate-900">Start a new academic year</h2>
          <p className="mt-1 text-sm text-slate-500">Set up dates, classes, student placements, and draft schedules in one guided process.</p>
        </div>
      </header>
      {!success ? <>
        <div className="border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
          <div className="mb-2 flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Step {step + 1} of {steps.length}</span><span>{Math.round(((step + 1) / steps.length) * 100)}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${((step + 1) / steps.length) * 100}%` }} /></div>
          <div className="mt-3 grid grid-cols-3 gap-1 sm:grid-cols-9">
            {steps.map((label, index) => <button key={label} type="button" disabled={index > step}
              onClick={() => { setError(''); setStep(index); }}
              className={`rounded px-1 py-1.5 text-[10px] font-semibold sm:text-xs ${index === step ? 'bg-blue-50 text-blue-800' : index < step ? 'text-emerald-700' : 'text-slate-400'}`}>
              {index < step ? <Check size={12} className="mr-1 inline" /> : null}{label}
            </button>)}
          </div>
        </div>
        <main className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          {optionsError && <div className="mb-4"><ErrorPanel message={optionsError} /></div>}
          {optionsLoading && <div role="status" className="mb-4 flex items-center gap-2 text-sm text-slate-500"><LoaderCircle size={16} className="animate-spin" />Loading template records…</div>}
          {error && !(step === 0 && yearValidationMessage) &&
            <div className="mb-4" role="alert" aria-live="polite"><ErrorPanel message={error} /></div>}
          {step === 0 && <div className="mx-auto max-w-2xl space-y-4">
            <p className="text-sm text-slate-600">Create the target year first. Its records will be added together only after review and confirmation.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label htmlFor="transition-year-name" className="block text-sm font-medium text-slate-700">Academic year name
                  <input id="transition-year-name" required maxLength={30} value={year.name} readOnly
                    aria-invalid={Boolean(yearTouched.name && yearFieldErrors.name)}
                    aria-describedby={yearTouched.name && yearFieldErrors.name ? 'transition-year-name-error' : 'transition-year-name-help'}
                    onBlur={() => setYearTouched(previous => ({ ...previous, name: true }))}
                    placeholder="2027–2028"
                    className={`mt-1.5 block w-full rounded-lg border bg-slate-50 px-3 py-2.5 text-sm outline-none ${yearTouched.name && yearFieldErrors.name ? 'border-red-400' : 'border-slate-300'}`} />
                </label>
                {yearTouched.name && yearFieldErrors.name
                  ? <span id="transition-year-name-error" role="alert" className="mt-1 block text-xs font-medium text-red-700">{yearFieldErrors.name}</span>
                  : <span id="transition-year-name-help" className="mt-1 block text-xs font-normal text-slate-500">Generated automatically from the selected dates.</span>}
              </div>
              <div>
                <label htmlFor="transition-year-start" className="block text-sm font-medium text-slate-700">Start date
                  <input id="transition-year-start" required type="date" value={year.start_date}
                    aria-invalid={Boolean(yearTouched.start_date && yearFieldErrors.start_date)}
                    aria-describedby={yearTouched.start_date && yearFieldErrors.start_date ? 'transition-year-start-error' : undefined}
                    onBlur={() => setYearTouched(previous => ({ ...previous, start_date: true }))}
                    onChange={event => { setYearTouched(previous => ({ ...previous, start_date: true })); updateYearStartDate(event.target.value); }}
                    className={`mt-1.5 block w-full rounded-lg border px-3 py-2.5 text-sm outline-none focus:border-blue-500 ${yearTouched.start_date && yearFieldErrors.start_date ? 'border-red-400' : 'border-slate-300'}`} />
                </label>
                {yearTouched.start_date && yearFieldErrors.start_date && <span id="transition-year-start-error" role="alert" className="mt-1 block text-xs font-medium text-red-700">{yearFieldErrors.start_date}</span>}
              </div>
              <div>
                <label htmlFor="transition-year-end" className="block text-sm font-medium text-slate-700">End date
                  <input id="transition-year-end" required type="date" value={year.end_date}
                    aria-invalid={Boolean(yearTouched.end_date && yearFieldErrors.end_date)}
                    aria-describedby={yearTouched.end_date && yearFieldErrors.end_date ? 'transition-year-end-error' : undefined}
                    onBlur={() => setYearTouched(previous => ({ ...previous, end_date: true }))}
                    onChange={event => {
                      const endDate = event.target.value;
                      setYearTouched(previous => ({ ...previous, end_date: true }));
                      setError('');
                      setYear(previous => ({
                        ...previous,
                        end_date: endDate,
                        name: academicYearName(previous.start_date, endDate)
                      }));
                    }}
                    className={`mt-1.5 block w-full rounded-lg border px-3 py-2.5 text-sm outline-none focus:border-blue-500 ${yearTouched.end_date && yearFieldErrors.end_date ? 'border-red-400' : 'border-slate-300'}`} />
                </label>
                {yearTouched.end_date && yearFieldErrors.end_date && <span id="transition-year-end-error" role="alert" className="mt-1 block text-xs font-medium text-red-700">{yearFieldErrors.end_date}</span>}
              </div>
            </div>
          </div>}

          {step === 1 && <div className="mx-auto max-w-2xl space-y-4">
            <p className="text-sm text-slate-600">Select the year to copy from. Historical enrollments, attendance, assessments, scores, and results are never copied.</p>
            <SearchableSelect name="transition_source_year" label="Previous academic year" options={academicYears}
              value={sourceYearId} onChange={setSourceYearId} getOptionLabel={item => item.name}
              getOptionSearchText={item => `${item.name} ${item.start_date} ${item.end_date}`}
              placeholder="Search academic years…" emptyValueLabel="Choose a template" required />
            {options && <Card className="mt-4"><p className="font-semibold">{options.source_year.name}</p>
              <p className="mt-1 text-sm text-slate-500">{String(options.source_year.start_date).slice(0, 10)} – {String(options.source_year.end_date).slice(0, 10)}</p>
              <p className="mt-3 text-sm text-slate-600">{options.students.length} students · {options.classes.length} classes · {options.subject_enrollments.length} subject enrollments</p>
            </Card>}
          </div>}

          {step === 2 && <div className="space-y-4">
            <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm">
              <input type="checkbox" checked={copy.classes} onChange={event => setClassCopyMode(event.target.checked)} className="mt-0.5 h-4 w-4 accent-blue-600" />
              <span><strong>Copy classes and grade-level structure</strong><span className="mt-1 block text-slate-500">Grades advance automatically where possible (for example, Grade 7 to Grade 8), and matching class names update too. Edit either value below. Turn this off to create a fresh class structure instead.</span></span>
            </label>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold text-slate-900">{copy.classes ? 'Copied and additional classes' : 'New classes'}</h3>
                <p className="mt-1 text-sm text-slate-500">{copy.classes
                  ? 'Copied classes are advanced automatically. Add more classes here; all rows can be edited before continuing.'
                  : 'Add classes from scratch. These will be available for homeroom and subject enrollment.'}</p>
              </div>
              <button type="button" onClick={addClass}
                className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-800">
                <Plus size={16} /> Add class
              </button>
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full min-w-[700px] text-left text-sm"><thead className="border-b bg-slate-50 text-xs uppercase text-slate-500"><tr>
                {[...(copy.classes ? ['Source class', 'New class name'] : ['Class name']), 'New grade', 'Capacity', 'Homeroom teacher', 'Action'].map(label => <th key={label} className="px-3 py-2.5">{label}</th>)}
              </tr></thead><tbody className="divide-y divide-slate-100">{classes.map((row, index) => <tr key={row.source_class_id}>
                {copy.classes && <td className="px-3 py-3">{row.template_class_id
                  ? `${sourceClassById.get(row.template_class_id)?.grade_level || ''} · ${sourceClassById.get(row.template_class_id)?.name || ''}`
                  : 'Added class'}</td>}
                <td className="px-3 py-2"><input aria-label={`New class name ${index + 1}`} maxLength={80} value={row.name} onChange={event => updateClass(index, 'name', event.target.value)} className="w-full rounded border px-2 py-2" /></td>
                <td className="px-3 py-2"><SearchableSelect
                  name={`transition_class_grade_${index}`}
                  label="Grade level"
                  hideLabel
                  options={gradeLevelOptions.map(level => ({ id: level, name: level }))}
                  value={row.grade_level}
                  onChange={value => updateClass(index, 'grade_level', value)}
                  getOptionId={option => option.name}
                  getOptionLabel={option => option.name}
                  getOptionSearchText={option => option.name}
                  placeholder="Search grades..."
                  emptyValueLabel="Choose grade"
                  emptyLabel="No grade levels are configured."
                  required
                /></td>
                <td className="px-3 py-2"><input type="number" min="1" max="500" value={row.capacity} onChange={event => updateClass(index, 'capacity', Number(event.target.value))} className="w-24 rounded border px-2 py-2" /></td>
                <td className="px-2 py-2"><SearchableSelect
                  name={`transition_class_teacher_${index}`}
                  label="Homeroom teacher"
                  hideLabel
                  options={options?.teachers || []}
                  value={row.homeroom_teacher_id}
                  onChange={value => updateClass(index, 'homeroom_teacher_id', value)}
                  getOptionLabel={teacher => teacher.full_name}
                  getOptionSearchText={teacher => `${teacher.full_name} ${teacher.employee_id || ''}`}
                  placeholder="Search teachers..."
                  emptyValueLabel="Unassigned"
                  noneLabel="Unassigned"
                  emptyLabel="No active teachers are available."
                /></td>
                <td className="px-3 py-2">{!row.template_class_id && <button type="button" onClick={() => removeClass(index)}
                  className="rounded-lg px-2 py-1 text-sm font-semibold text-red-700 hover:bg-red-50">Remove</button>}</td>
              </tr>)}</tbody></table>
              {!classes.length && <p className="p-5 text-sm text-slate-500">{copy.classes ? 'No active classes exist in this template year.' : 'No new classes added yet.'}</p>}
            </div>
            {classes.length === 0 && selectedStudents.length > 0 && <p className="text-sm text-amber-800" role="status">Add at least one class before assigning selected students to homerooms or subjects.</p>}
          </div>}

          {step === 3 && <div className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div><h3 className="font-semibold text-slate-900">Review promotion decisions</h3><p className="mt-1 text-sm text-slate-500">Promotion is separate from each subject’s outcome. Failed subjects do not automatically repeat the whole grade.</p></div>
              <span className="text-sm font-semibold text-slate-600">{selectedStudents.length} selected</span>
            </div>
            <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2 xl:grid-cols-3">
              <label className="block min-w-0 text-sm font-medium text-slate-700">
                Search students
                <input type="search" value={studentSearch} onChange={event => setStudentSearch(event.target.value)}
                  placeholder="Search by name or code..." aria-label="Search students"
                  list="transition-promotion-student-suggestions"
                  className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm" />
                <datalist id="transition-promotion-student-suggestions">
                  {studentSearchSuggestions.map(suggestion => <option key={suggestion} value={suggestion} />)}
                </datalist>
              </label>
              <SearchableSelect
                name="transition_student_grade_filter"
                label="Filter by grade"
                options={studentGradeOptions}
                value={studentGradeFilter}
                onChange={setStudentGradeFilter}
                getOptionLabel={grade => grade.name}
                getOptionSearchText={grade => grade.name}
                placeholder="Search grades..."
                emptyValueLabel="All grades"
                noneLabel="All grades"
              />
              <SearchableSelect
                name="transition_student_class_filter"
                label="Filter by class"
                options={studentClassOptions}
                value={studentClassFilter}
                onChange={setStudentClassFilter}
                getOptionLabel={classOption => classOption.name}
                getOptionSearchText={classOption => classOption.searchText}
                placeholder="Search classes..."
                emptyValueLabel="All classes"
                noneLabel="All classes"
              />
            </div>
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox"
              checked={filteredStudents.length > 0 && filteredStudents.every(student => selectedIds.has(student.id))}
              onChange={toggleVisibleStudents} className="h-4 w-4 accent-blue-600" /> Select all matching students</label>
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full min-w-[820px] text-left text-sm"><thead className="border-b bg-slate-50 text-xs uppercase text-slate-500"><tr>
                {['Select', 'Student', 'Main grade', 'Promotion decision'].map(label => <th key={label} className="px-3 py-2.5">{label}</th>)}
              </tr></thead><tbody className="divide-y divide-slate-100">{filteredStudents.map(student => <tr key={student.id}>
                <td className="px-3 py-3"><input type="checkbox" checked={selectedIds.has(student.id)} onChange={() => toggleStudent(student.id)} aria-label={`Select ${student.english_name}`} className="h-4 w-4 accent-blue-600" /></td>
                <td className="px-3 py-3"><strong>{student.english_name}</strong><span className="block text-xs text-slate-500">{student.student_code}</span></td>
                <td className="px-3 py-3">{student.grade_level} · {student.class_name}</td>
                <td className="px-2 py-2"><SearchableSelect
                  name={`transition_promotion_${student.id}`}
                  label={`Promotion decision for ${student.english_name}`}
                  hideLabel
                  options={promotionStatusOptions}
                  value={currentStudent(student).promotion_status}
                  onChange={status => updatePromotion(student.id, {
                    promotion_status: status,
                    ...(status === 'Promoted' || status === 'Conditional Promotion' || status === 'Retained/Repeat'
                      ? {} : { homeroom_class_source_id: '', class_enrollments: [] })
                  })}
                  getOptionLabel={status => status.name}
                  getOptionSearchText={status => status.name}
                  placeholder="Search decisions..."
                  emptyValueLabel="Choose decision"
                /></td>
              </tr>)}</tbody></table>
              {!filteredStudents.length && <p className="p-5 text-sm text-slate-500">No matching students in this year.</p>}
            </div>
            {options?.subject_enrollments.length > 0 && <Card>
              <h4 className="font-semibold">Previous subject outcomes</h4>
              <p className="mb-3 mt-1 text-xs text-slate-500">These outcomes are recorded against the prior subject enrollment and remain separate from promotion decisions.</p>
              <div className="max-h-60 space-y-2 overflow-y-auto">
                {options.subject_enrollments.filter(item => selectedIds.has(item.student_id)).map(item => {
                  const key = `${item.student_id}:${item.class_id}:${item.subject_id}`;
                  return <div key={key} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2 text-sm">
                    <span>{item.english_name} · {item.grade_level} {item.class_name} · {item.subject_name}</span>
                    <div className="min-w-44">
                      <SearchableSelect
                        name={`transition_outcome_${key.replaceAll(':', '-')}`}
                        label={`${item.english_name} ${item.subject_name} outcome`}
                        hideLabel
                        options={subjectOutcomeOptions}
                        value={outcomes[key]?.outcome || 'Not Assessed'}
                        onChange={outcome => setOutcomes(previous => ({ ...previous, [key]: { ...previous[key], outcome } }))}
                        getOptionLabel={outcome => outcome.name}
                        getOptionSearchText={outcome => outcome.name}
                        placeholder="Search outcomes..."
                        emptyValueLabel="Not Assessed"
                      />
                    </div>
                  </div>;
                })}
              </div>
            </Card>}
          </div>}

          {step === 4 && <div className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h3 className="font-semibold text-slate-900">Assign main homerooms</h3>
                <p className="mt-1 text-sm text-slate-600">Each student has one main grade. Subject-class grades can differ in the next step.</p>
              </div>
              <span className="inline-flex w-fit items-center rounded-full bg-blue-50 px-3 py-1 text-sm font-semibold text-blue-800">
                {selectedStudents.length} students
              </span>
            </div>
            <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2 xl:grid-cols-3">
              <label className="block min-w-0 text-sm font-medium text-slate-700">
                Search students
                <input type="search" value={studentSearch} onChange={event => setStudentSearch(event.target.value)}
                  placeholder="Search by name or code..." aria-label="Search students for homeroom assignment"
                  list="transition-homeroom-student-suggestions"
                  className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm" />
                <datalist id="transition-homeroom-student-suggestions">
                  {studentSearchSuggestions.map(suggestion => <option key={suggestion} value={suggestion} />)}
                </datalist>
              </label>
              <SearchableSelect
                name="transition_homeroom_grade_filter"
                label="Filter by grade"
                options={studentGradeOptions}
                value={studentGradeFilter}
                onChange={setStudentGradeFilter}
                getOptionLabel={grade => grade.name}
                getOptionSearchText={grade => grade.name}
                placeholder="Search grades..."
                emptyValueLabel="All grades"
                noneLabel="All grades"
              />
              <SearchableSelect
                name="transition_homeroom_class_filter"
                label="Filter by class"
                options={studentClassOptions}
                value={studentClassFilter}
                onChange={setStudentClassFilter}
                getOptionLabel={classOption => classOption.name}
                getOptionSearchText={classOption => classOption.searchText}
                placeholder="Search classes..."
                emptyValueLabel="All classes"
                noneLabel="All classes"
              />
              <span className="self-center text-xs font-medium text-slate-500 sm:col-span-2 xl:col-span-3">
                Showing {selectedFilteredStudents.length} of {selectedStudents.length} selected
              </span>
            </div>
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Student</th>
                      <th className="px-4 py-3">Current grade</th>
                      <th className="w-[42%] px-4 py-3">New main homeroom</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {selectedFilteredStudents.map(student => {
                      const studentId = student.id;
                      const promotion = promotions[studentId];
                      if (!promotion) return null;
                      if (!['Promoted', 'Conditional Promotion', 'Retained/Repeat'].includes(promotion.promotion_status)) {
                        return <tr key={studentId} className="bg-slate-50/60">
                          <td className="px-4 py-3">
                            <p className="font-semibold text-slate-800">{student.english_name}</p>
                            <p className="mt-0.5 text-xs text-slate-500">{student.student_code}</p>
                          </td>
                          <td className="px-4 py-3 text-slate-600">{student.grade_level || '—'}</td>
                          <td className="px-4 py-3">
                            <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                              {promotion.promotion_status} · no new enrollment
                            </span>
                          </td>
                        </tr>;
                      }
                      return <tr key={studentId} className="transition-colors hover:bg-blue-50/40">
                        <td className="px-4 py-2.5">
                          <p className="font-semibold text-slate-900">{student.english_name}</p>
                          <p className="mt-0.5 text-xs text-slate-500">{student.student_code}</p>
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">{student.grade_level || '—'}</span>
                        </td>
                        <td className="px-4 py-2.5">
                          <SearchableSelect
                            name={`transition_homeroom_${studentId}`}
                            label={`New main homeroom for ${student.english_name}`}
                            hideLabel
                            options={configuredClassOptions}
                            value={promotion.homeroom_class_source_id || ''}
                            onChange={value => updatePromotion(studentId, { homeroom_class_source_id: value })}
                            getOptionLabel={classOption => classOption.name}
                            getOptionSearchText={classOption => classOption.searchText}
                            placeholder="Search grade or class..."
                            emptyValueLabel="Choose homeroom"
                            noneLabel="Choose homeroom"
                            disabled={!classes.length}
                            required
                          />
                        </td>
                      </tr>;
                    })}
                  </tbody>
                </table>
                {!selectedFilteredStudents.length && <p className="p-8 text-center text-sm text-slate-500">
                  {selectedStudents.length ? 'No selected students match your search.' : 'No students selected. Go back to Promotion to choose students.'}
                </p>}
              </div>
            </div>
          </div>}

          {step === 5 && <div className="space-y-4">
            <div className="flex justify-end">
              <button type="button" onClick={() => { setError(''); setStep(6); }}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-800">
                Skip this optional step <ArrowRight size={15} />
              </button>
            </div>
            <div className="flex flex-col gap-3 rounded-xl border border-blue-100 bg-blue-50/60 p-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="font-semibold text-slate-900">Additional grade and class groups</h3>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">Optional: the main homeroom is already assigned. Add another class only when a student needs to study at an additional grade level. Subjects and teachers come from each class’s assignments.</p>
              </div>
              <span className="inline-flex w-fit shrink-0 items-center rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600">Optional</span>
            </div>
            <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-[minmax(240px,420px)_1fr] sm:items-end">
              <SearchableSelect
                name="transition_enrollment_student_search"
                label="Find a student"
                options={enrollmentStudentOptions}
                value={enrollmentStudentFilter}
                onChange={setEnrollmentStudentFilter}
                getOptionLabel={student => student.name}
                getOptionSearchText={student => student.searchText}
                placeholder="Search name, code, or grade..."
                emptyValueLabel="All eligible students"
                noneLabel="Show all eligible students"
                emptyLabel="No matching students."
              />
              <p className="pb-2 text-xs leading-5 text-slate-500">
                Search suggestions let you jump to one student. Leaving this blank shows everyone selected for promotion.
              </p>
            </div>
            {!classes.length && <ErrorPanel message="Add or copy classes in the Classes step before enrolling students." />}
            <div className="grid gap-4 xl:grid-cols-2">{selectedStudents
              .filter(studentId => !enrollmentStudentFilter || studentId === enrollmentStudentFilter)
              .map(studentId => {
              const student = options?.students.find(row => row.id === studentId);
              const promotion = promotions[studentId];
              if (!student || !promotion || !['Promoted', 'Conditional Promotion', 'Retained/Repeat'].includes(promotion.promotion_status)) return null;
              const enrolledClassIds = new Set(promotion.class_enrollments);
              const availableClasses = studentEnrollmentClassOptions.filter(option =>
                !enrolledClassIds.has(option.id) && option.id !== promotion.homeroom_class_source_id
              );
              const selectedClasses = promotion.class_enrollments
                .map(classId => configuredClassById.get(classId))
                .filter(Boolean);
              const homeroom = classes.find(row => row.source_class_id === promotion.homeroom_class_source_id);
              return <Card key={studentId} className="space-y-4 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-900">{student.english_name}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{student.student_code}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {homeroom && <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-800">
                      Main: {homeroom.grade_level}
                    </span>}
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                      {promotion.class_enrollments.length} additional
                    </span>
                  </div>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                  <SearchableSelect
                    name={`transition_enrollment_class_${studentId}`}
                    label="Add a grade and class"
                    options={availableClasses}
                    value={classChoice[studentId] || ''}
                    onChange={value => setClassChoice(previous => ({ ...previous, [studentId]: value }))}
                    getOptionLabel={classOption => classOption.name}
                    getOptionSearchText={classOption => classOption.searchText}
                    getOptionDetails={classOption => [{
                      label: 'Subjects',
                      value: classOption.subjectCount ? `${classOption.subjectCount} assigned` : 'Configure in Teachers & schedules'
                    }]}
                    placeholder="Search grade or class..."
                    emptyValueLabel={availableClasses.length ? 'Choose a grade and class (optional)' : 'All classes added'}
                    disabled={!classes.length || !availableClasses.length}
                  />
                  <button type="button" disabled={!classChoice[studentId]} onClick={() => {
                    updateClassEnrollment(studentId, classChoice[studentId], true);
                    setClassChoice(previous => ({ ...previous, [studentId]: '' }));
                  }} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"><Plus size={16} /> Add class</button>
                  </div>
                </div>
                <div className="space-y-2">
                  {selectedClasses.length ? selectedClasses.map(classRow => {
                    const subjectCount = classSubjectCounts.get(classRow.source_class_id) || 0;
                    return <div key={classRow.source_class_id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2.5">
                      <div>
                        <p className="text-sm font-semibold text-emerald-950">{classRow.grade_level} · {classRow.name}</p>
                        <p className="mt-0.5 text-xs text-emerald-800">{subjectCount ? `${subjectCount} assigned subject${subjectCount === 1 ? '' : 's'} included` : 'Subjects can be assigned in Teachers & schedules'}</p>
                      </div>
                      <button type="button" onClick={() => updateClassEnrollment(studentId, classRow.source_class_id, false)}
                        aria-label={`Remove ${classRow.grade_level} ${classRow.name} class enrollment`}
                        className="rounded-full p-1.5 text-emerald-800 hover:bg-emerald-100"><X size={15} /></button>
                    </div>;
                  }) : <p className="rounded-lg border border-dashed border-slate-200 px-3 py-3 text-center text-xs text-slate-500">No additional classes. This is fine if the student only needs their main homeroom.</p>}
                </div>
              </Card>;
            })}</div>
            {enrollmentStudentFilter && !enrollmentStudentOptions.some(student => student.id === enrollmentStudentFilter) &&
              <p className="rounded-lg border border-dashed border-slate-200 bg-white p-5 text-center text-sm text-slate-500">
                This student has no new enrollment under the selected promotion decision.
              </p>}
            {studentScheduleConflicts.length > 0 && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
              <p className="flex items-center gap-2 font-semibold"><AlertTriangle size={17} /> Student timetable overlaps must be resolved</p>
              <ul className="mt-2 list-disc pl-5">{studentScheduleConflicts.slice(0, 10).map(conflict => <li key={conflict}>{conflict}</li>)}</ul>
            </div>}
          </div>}

          {step === 6 && <div className="space-y-4">
            <p className="text-sm text-slate-600">Copy existing teacher assignments or configure new ones, then save them with schedules as inactive drafts. Drafts do not create attendance or assessment records.</p>
            <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm">
              <input type="checkbox" checked={copy.teacher_assignments} disabled={!classes.length} onChange={event => {
                const enabled = event.target.checked;
                setCopy({ ...copy, teacher_assignments: enabled, class_schedules: enabled && copy.class_schedules });
                if (!enabled) {
                  setTeacherAssignments([]);
                  setSchedules([]);
                }
              }} className="mt-0.5 h-4 w-4 accent-blue-600" />
              <span><strong>{copy.classes ? 'Copy teacher assignments as drafts' : 'Set up teacher assignments as drafts'}</strong><span className="mt-1 block text-slate-500">{copy.classes ? `${options?.teacher_assignments.length || 0} assignments in the selected year.` : 'Add assignments for your new classes.'}</span></span>
            </label>
            {copy.teacher_assignments && <div className="space-y-3">
              <div className="flex items-center justify-between gap-3"><h4 className="font-semibold">Teacher assignments</h4>
                <button type="button" onClick={addTeacherAssignment} disabled={!classes.length || !options?.subjects.length || !options?.teachers.length}
                  className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-800 disabled:opacity-50">Add assignment</button>
              </div>
              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                <table className="w-full min-w-[700px] text-left text-sm"><thead className="border-b bg-slate-50 text-xs uppercase text-slate-500"><tr>
                  {['Class / grade', 'Subject', 'Teacher', 'Action'].map(label => <th key={label} className="px-3 py-2.5">{label}</th>)}
                </tr></thead><tbody className="divide-y divide-slate-100">{teacherAssignments.map((row, index) => <tr key={`${row.class_source_id}:${row.subject_id}:${row.teacher_id}:${index}`}>
                  <td className="px-2 py-2"><SearchableSelect name={`transition_assignment_class_${index}`} label={`Class for assignment ${index + 1}`} hideLabel
                    options={configuredClassOptions} value={row.class_source_id} onChange={value => updateAssignment(index, 'class_source_id', value)}
                    getOptionLabel={item => item.name} getOptionSearchText={item => item.searchText} placeholder="Search class..." /></td>
                  <td className="px-2 py-2"><SearchableSelect name={`transition_assignment_subject_${index}`} label={`Subject for assignment ${index + 1}`} hideLabel
                    options={options?.subjects || []} value={row.subject_id} onChange={value => updateAssignment(index, 'subject_id', value)}
                    getOptionLabel={item => item.name} getOptionSearchText={item => `${item.name} ${item.code || ''}`} placeholder="Search subject..." /></td>
                  <td className="px-2 py-2"><SearchableSelect name={`transition_assignment_teacher_${index}`} label={`Teacher for assignment ${index + 1}`} hideLabel
                    options={options?.teachers || []} value={row.teacher_id} onChange={value => updateAssignment(index, 'teacher_id', value)}
                    getOptionLabel={item => item.full_name} getOptionSearchText={item => `${item.full_name} ${item.employee_id || ''}`} placeholder="Search teacher..." /></td>
                  <td className="px-3 py-2"><button type="button" onClick={() => removeAssignment(index)} className="rounded p-2 text-red-700 hover:bg-red-50" aria-label="Remove teacher assignment"><X size={16} /></button></td>
                </tr>)}</tbody></table>
                {!teacherAssignments.length && <p className="p-4 text-sm text-slate-500">No assignments configured.</p>}
              </div>
            </div>}
            <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm">
              <input type="checkbox" checked={copy.class_schedules} disabled={!copy.teacher_assignments} onChange={event => {
                setCopy({ ...copy, class_schedules: event.target.checked });
                if (!event.target.checked) setSchedules([]);
              }} className="mt-0.5 h-4 w-4 accent-blue-600" />
              <span><strong>Copy class schedules as drafts</strong><span className="mt-1 block text-slate-500">{options?.schedules.length || 0} schedule slots in the selected year.</span></span>
            </label>
            {copy.class_schedules && <div className="space-y-3">
              <div className="flex items-center justify-between gap-3"><h4 className="font-semibold">Class schedules</h4>
                <button type="button" onClick={addSchedule} disabled={!teacherAssignments.length}
                  className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-800 disabled:opacity-50">Add schedule</button>
              </div>
              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                <table className="w-full min-w-[980px] text-left text-sm"><thead className="border-b bg-slate-50 text-xs uppercase text-slate-500"><tr>
                  {['Class / grade', 'Subject', 'Teacher', 'Day', 'Start', 'End', 'Room', 'Action'].map(label => <th key={label} className="px-3 py-2.5">{label}</th>)}
                </tr></thead><tbody className="divide-y divide-slate-100">{schedules.map((row, index) => <tr key={`${row.class_source_id}:${row.subject_id}:${row.teacher_id}:${index}`}>
                  <td className="px-2 py-2"><SearchableSelect name={`transition_schedule_class_${index}`} label={`Class for schedule ${index + 1}`} hideLabel
                    options={configuredClassOptions} value={row.class_source_id} onChange={value => updateSchedule(index, 'class_source_id', value)}
                    getOptionLabel={item => item.name} getOptionSearchText={item => item.searchText} placeholder="Search class..." /></td>
                  <td className="px-2 py-2"><SearchableSelect name={`transition_schedule_subject_${index}`} label={`Subject for schedule ${index + 1}`} hideLabel
                    options={options?.subjects || []} value={row.subject_id} onChange={value => updateSchedule(index, 'subject_id', value)}
                    getOptionLabel={item => item.name} getOptionSearchText={item => `${item.name} ${item.code || ''}`} placeholder="Search subject..." /></td>
                  <td className="px-2 py-2"><SearchableSelect name={`transition_schedule_teacher_${index}`} label={`Teacher for schedule ${index + 1}`} hideLabel
                    options={options?.teachers || []} value={row.teacher_id} onChange={value => updateSchedule(index, 'teacher_id', value)}
                    getOptionLabel={item => item.full_name} getOptionSearchText={item => `${item.full_name} ${item.employee_id || ''}`} placeholder="Search teacher..." /></td>
                  <td className="px-2 py-2"><SearchableSelect name={`transition_schedule_day_${index}`} label={`Day for schedule ${index + 1}`} hideLabel
                    options={weekDayOptions} value={String(row.day_of_week)} onChange={value => updateSchedule(index, 'day_of_week', Number(value))}
                    getOptionLabel={item => item.name} getOptionSearchText={item => item.name} placeholder="Search day..." /></td>
                  <td className="px-3 py-2"><input type="time" value={row.start_time} onChange={event => updateSchedule(index, 'start_time', event.target.value)} className="rounded border px-2 py-2" /></td>
                  <td className="px-3 py-2"><input type="time" value={row.end_time} onChange={event => updateSchedule(index, 'end_time', event.target.value)} className="rounded border px-2 py-2" /></td>
                  <td className="px-3 py-2"><input maxLength={80} value={row.room} onChange={event => updateSchedule(index, 'room', event.target.value)} className="w-28 rounded border px-2 py-2" /></td>
                  <td className="px-3 py-2"><button type="button" onClick={() => setSchedules(previous => previous.filter((_, rowIndex) => rowIndex !== index))} className="rounded p-2 text-red-700 hover:bg-red-50" aria-label="Remove schedule"><X size={16} /></button></td>
                </tr>)}</tbody></table>
                {!schedules.length && <p className="p-4 text-sm text-slate-500">No schedules configured.</p>}
              </div>
            </div>}
            {scheduleConflicts.length > 0 && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
              <p className="flex items-center gap-2 font-semibold"><AlertTriangle size={17} /> Timetable conflicts must be resolved</p>
              <ul className="mt-2 list-disc pl-5">{scheduleConflicts.slice(0, 10).map(conflict => <li key={conflict}>{conflict}</li>)}</ul>
            </div>}
          </div>}

          {step === 7 && <div className="space-y-4">
            <p className="text-sm text-slate-600">Reuse year-specific terms and grading bands. Term dates are aligned to the new year’s start date; edit individual dates here after setting the year dates.</p>
            <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm">
              <input type="checkbox" checked={copy.terms} onChange={event => setCopy({ ...copy, terms: event.target.checked })} className="mt-0.5 h-4 w-4 accent-blue-600" />
              <span><strong>Copy terms</strong><span className="mt-1 block text-slate-500">{options?.terms.length || 0} term definitions in the selected year.</span></span>
            </label>
            {copy.terms && terms.map((term, index) => {
              const dateIssue = termDateIssue(term, year);
              const normalizedName = term.name.trim().toLowerCase();
              const duplicateName = Boolean(normalizedName) && terms.some((other, otherIndex) =>
                otherIndex !== index && other.name.trim().toLowerCase() === normalizedName
              );
              const issue = !normalizedName ? 'Enter a term name.' : dateIssue || (duplicateName ? 'Term names must be unique.' : '');
              return <Card key={term.source_term_id || index} className={`grid gap-3 sm:grid-cols-[1fr_1fr_1fr] ${issue ? 'border-amber-300' : ''}`}>
                <label className="block text-sm font-medium text-slate-700 sm:col-span-3">Term name<input maxLength={80} value={term.name} aria-invalid={!normalizedName || duplicateName} onChange={event => updateTerm(index, 'name', event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2" /></label>
                <label className="block text-sm font-medium text-slate-700">Start date<input type="date" value={term.start_date} aria-invalid={Boolean(dateIssue)} onChange={event => updateTerm(index, 'start_date', event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2" /></label>
                <label className="block text-sm font-medium text-slate-700 sm:col-span-2">End date<input type="date" value={term.end_date} aria-invalid={Boolean(dateIssue)} onChange={event => updateTerm(index, 'end_date', event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2" /></label>
              </Card>;
            })}
            <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm">
              <input type="checkbox" checked={copy.grading_scales} onChange={event => setCopy({ ...copy, grading_scales: event.target.checked })} className="mt-0.5 h-4 w-4 accent-blue-600" />
              <span><strong>Copy grading scales</strong><span className="mt-1 block text-slate-500">{options?.grading_scales.length || 0} grading bands in the selected year.</span></span>
            </label>
            {copy.grading_scales && options?.grading_scales.map(scale => <p key={scale.id} className="rounded-lg bg-white px-4 py-2 text-sm text-slate-700">{scale.label} · {scale.minimum_percentage}%–{scale.maximum_percentage}%{scale.description ? ` · ${scale.description}` : ''}</p>)}
            <div className="rounded-xl border border-slate-200 bg-slate-100 p-4 text-sm text-slate-600">
              The current schema has no separate holiday calendar or assessment-category configuration tables. Historical assessments, scores, attendance, and results are deliberately not copied.
            </div>
          </div>}

          {step === 8 && <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ['Target year', year.name || 'Not named'],
                ['Students', selectedStudents.length],
                ['Homeroom classes', selectedPromotions.filter(item => item.homeroom_class_source_id).length],
                ['Grade/class enrollments', selectedPromotions.reduce((total, item) =>
                  total + item.class_enrollments.length + (item.homeroom_class_source_id ? 1 : 0), 0)],
                [copy.classes ? 'Copied classes' : 'New classes', classes.length],
                ['Terms', copy.terms ? terms.length : 0],
                ['Teacher assignments', copy.teacher_assignments ? teacherAssignments.length : 0],
                ['Draft schedules', copy.class_schedules ? schedules.length : 0]
              ].map(([label, value]) => <Card key={label}><p className="text-xs font-semibold uppercase text-slate-500">{label}</p><p className="mt-1 text-xl font-bold text-slate-900">{value}</p></Card>)}
            </div>
            {studentScheduleConflicts.length > 0 && <ErrorPanel message="Student timetable conflicts are still present. Go back to Grade & classes and resolve them before confirming." />}
            {scheduleConflicts.length > 0 && <ErrorPanel message="Resolve teacher, class, and classroom schedule overlaps before confirming." />}
            <label className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm">
              <input type="checkbox" checked={activateYear} onChange={event => setActivateYear(event.target.checked)} className="mt-0.5 h-4 w-4 accent-blue-600" />
              <span><strong>Set the new year as Current after all transition records are created</strong><span className="mt-1 block text-blue-900/80">Otherwise it remains Upcoming. Teacher assignments and schedules remain drafts until activated separately.</span></span>
            </label>
            <label className="flex items-start gap-3 rounded-xl border border-slate-300 bg-white p-4 text-sm font-semibold">
              <input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-0.5 h-4 w-4 accent-blue-600" />
              <span>I reviewed the promotion decisions, subject outcomes, enrollment grades, and template records. No historical attendance, assessments, scores, or results will be overwritten.</span>
            </label>
          </div>}
        </main>
        <footer className="flex shrink-0 items-center gap-3 border-t border-slate-200 bg-white px-4 py-3 sm:px-6">
          <button type="button" disabled={step === 0 || busy} onClick={() => { setError(''); setStep(previous => previous - 1); }}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold disabled:opacity-50"><ArrowLeft size={16} /> Back</button>
          <div className="ml-auto">
            {step < steps.length - 1
              ? <button type="button" disabled={busy} onClick={nextStep} className="primary-action inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold disabled:opacity-50">Continue <ArrowRight size={16} /></button>
              : <button type="button" disabled={busy || !confirmed || studentScheduleConflicts.length > 0 || !year.name || !year.start_date || !year.end_date}
                onClick={submitTransition} className="primary-action inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold disabled:opacity-50">
                {busy ? <><LoaderCircle size={16} className="animate-spin" /> Completing transition…</> : <><Check size={16} /> Confirm transition</>}
              </button>}
          </div>
        </footer>
      </> : <main className="overflow-y-auto p-6 sm:p-10">
        <div className="mx-auto max-w-xl rounded-2xl border border-emerald-200 bg-white p-6 text-center shadow-sm">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-50 text-emerald-700"><Check size={28} /></div>
          <h3 className="mt-4 text-xl font-bold text-slate-900">Transition completed</h3>
          <p className="mt-2 text-sm text-slate-600">{success.counts.students} student decision(s), {success.counts.classes} class(es), {success.counts.terms} term(s) and {success.counts.schedules} draft schedule(s) were recorded.</p>
          <p className="mt-3 text-sm font-semibold text-blue-800">New year status: {success.status}</p>
          <button type="button" onClick={onClose} className="mt-5 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white">Done</button>
        </div>
      </main>}
    </div>
  </section>;
}
