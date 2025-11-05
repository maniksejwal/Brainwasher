/**
 * @fileoverview Hospital OPD and IPD Scenarios
 * Outpatient Department (OPD) and Inpatient Department (IPD) scenarios
 * with different departments, specializations, and disease progression stages
 */

export const HOSPITAL_SCENARIOS = {
    // ========== OPD (OUTPATIENT DEPARTMENT) SCENARIOS ==========
    
    opd_cardiology_initial: {
        name: '🏥 OPD Cardiology - Initial Consultation',
        description: 'Patient visiting cardiology OPD for first time with chest pain concerns',
        category: 'hospital_opd',
        complexity: 3,
        users: [
            { role: 'patient', personaKey: 'anxious_patient' },
            { role: 'caregiver', personaKey: 'engaged_caregiver' }
        ],
        instructions: {
            patient: 'You are visiting the cardiology OPD for the first time. You have been experiencing chest pain and shortness of breath. You are anxious about what the doctor will find.',
            caregiver: 'You are accompanying the patient to their cardiology appointment. You are concerned about their symptoms and want to ensure they get proper care.',
            agent: 'Help the patient prepare for their cardiology appointment, gather symptom details, and support the caregiver in understanding the process.'
        },
        turns: 8,
        department: 'cardiology',
        stage: 'initial_consultation',
        specialization: 'cardiology'
    },
    
    opd_cardiology_followup: {
        name: '🏥 OPD Cardiology - Follow-up After Diagnosis',
        description: 'Patient returning for follow-up after receiving heart condition diagnosis',
        category: 'hospital_opd',
        complexity: 4,
        users: [
            { role: 'patient', personaKey: 'medication_nonadherent' },
            { role: 'caregiver', personaKey: 'helicopter_caregiver' }
        ],
        instructions: {
            patient: 'You have been diagnosed with a heart condition and are returning for a follow-up. You have been inconsistent with your medications and lifestyle changes.',
            caregiver: 'You are very concerned about the patient\'s medication adherence and want to ensure they follow the doctor\'s recommendations.',
            agent: 'Support medication adherence, address concerns about the diagnosis, and help prepare for the follow-up appointment.'
        },
        turns: 10,
        department: 'cardiology',
        stage: 'post_diagnosis',
        specialization: 'cardiology'
    },
    
    opd_diabetes_management: {
        name: '🏥 OPD Endocrinology - Diabetes Management',
        description: 'Patient with diabetes managing blood sugar levels and medication adjustments',
        category: 'hospital_opd',
        complexity: 4,
        users: [
            { role: 'patient', personaKey: 'denial_prone' },
            { role: 'caregiver', personaKey: 'engaged_caregiver' }
        ],
        instructions: {
            patient: 'You have diabetes and are managing your condition. You sometimes minimize symptoms and skip blood sugar checks. You have an upcoming endocrinology appointment.',
            caregiver: 'You are monitoring the patient\'s diabetes management and are concerned about blood sugar fluctuations. You want to ensure proper medication adherence.',
            agent: 'Help track symptoms, support medication adherence, and prepare questions for the endocrinology appointment.'
        },
        turns: 8,
        department: 'endocrinology',
        stage: 'ongoing_management',
        specialization: 'endocrinology'
    },
    
    opd_oncology_chemotherapy: {
        name: '🏥 OPD Oncology - Pre-Chemotherapy Support',
        description: 'Patient preparing for chemotherapy treatment, managing anxiety and side effects',
        category: 'hospital_opd',
        complexity: 5,
        users: [
            { role: 'patient', personaKey: 'anxious_patient' },
            { role: 'caregiver', personaKey: 'burned_out_caregiver' }
        ],
        instructions: {
            patient: 'You are preparing for chemotherapy treatment. You are extremely anxious about side effects, treatment outcomes, and the impact on your daily life.',
            caregiver: 'You are supporting the patient through cancer treatment but feeling overwhelmed by the emotional and practical demands.',
            agent: 'Provide emotional support, help manage treatment-related anxiety, and assist with preparing for chemotherapy sessions.'
        },
        turns: 10,
        department: 'oncology',
        stage: 'pre_treatment',
        specialization: 'oncology'
    },
    
    opd_pediatrics_fever: {
        name: '🏥 OPD Pediatrics - Child with Persistent Fever',
        description: 'Parent bringing child to pediatric OPD with persistent fever concerns',
        category: 'hospital_opd',
        complexity: 3,
        users: [
            { role: 'caregiver', personaKey: 'helicopter_caregiver' }
        ],
        instructions: {
            caregiver: 'Your child has been having a persistent fever for several days. You are worried and want to ensure they get proper medical attention. You are preparing for a pediatric appointment.',
            agent: 'Help gather symptom information, provide reassurance, and prepare the caregiver for the pediatric consultation.'
        },
        turns: 8,
        department: 'pediatrics',
        stage: 'symptom_management',
        specialization: 'pediatrics'
    },
    
    opd_orthopedics_fracture: {
        name: '🏥 OPD Orthopedics - Fracture Recovery',
        description: 'Patient recovering from fracture, managing pain and mobility issues',
        category: 'hospital_opd',
        complexity: 3,
        users: [
            { role: 'patient', personaKey: 'elderly_cognitive' },
            { role: 'caregiver', personaKey: 'engaged_caregiver' }
        ],
        instructions: {
            patient: 'You are recovering from a fracture. You have memory issues and sometimes forget to do your exercises or take pain medication. You have a follow-up orthopedic appointment.',
            caregiver: 'You are helping the patient recover from their fracture. You are concerned about their compliance with exercises and medication.',
            agent: 'Support recovery, track exercise adherence, and help prepare for the orthopedic follow-up.'
        },
        turns: 8,
        department: 'orthopedics',
        stage: 'recovery',
        specialization: 'orthopedics'
    },
    
    opd_psychiatry_depression: {
        name: '🏥 OPD Psychiatry - Depression Management',
        description: 'Patient managing depression, medication adherence, and therapy sessions',
        category: 'hospital_opd',
        complexity: 4,
        users: [
            { role: 'patient', personaKey: 'anxious_patient' },
            { role: 'caregiver', personaKey: 'engaged_caregiver' }
        ],
        instructions: {
            patient: 'You are managing depression with medication and therapy. You sometimes feel hopeless and want to skip appointments or medications.',
            caregiver: 'You are supporting the patient through their mental health journey and are concerned about their medication adherence and therapy attendance.',
            agent: 'Provide emotional support, help maintain medication schedule, and encourage therapy attendance.'
        },
        turns: 10,
        department: 'psychiatry',
        stage: 'ongoing_treatment',
        specialization: 'psychiatry'
    },
    
    // ========== IPD (INPATIENT DEPARTMENT) SCENARIOS ==========
    
    ipd_post_surgery_recovery: {
        name: '🏥 IPD Post-Surgery Recovery',
        description: 'Patient recovering from surgery in hospital, managing pain and mobility',
        category: 'hospital_ipd',
        complexity: 4,
        users: [
            { role: 'patient', personaKey: 'elderly_cognitive' },
            { role: 'caregiver', personaKey: 'helicopter_caregiver' }
        ],
        instructions: {
            patient: 'You are recovering from surgery in the hospital. You are in pain, confused, and want to go home. You sometimes forget why you are there.',
            caregiver: 'You are visiting the patient daily in the hospital. You are concerned about their recovery, pain management, and want to ensure they follow medical advice.',
            agent: 'Help manage post-surgery recovery, track pain levels, and support communication with hospital staff.'
        },
        turns: 10,
        department: 'general_surgery',
        stage: 'post_surgical',
        specialization: 'surgery',
        setting: 'inpatient'
    },
    
    ipd_icu_critical_care: {
        name: '🏥 IPD ICU - Critical Care Support',
        description: 'Patient in ICU, family member managing information and decision-making',
        category: 'hospital_ipd',
        complexity: 5,
        users: [
            { role: 'caregiver', personaKey: 'anxious_patient' } // Using anxious persona for caregiver under stress
        ],
        instructions: {
            caregiver: 'Your loved one is in the ICU. You are receiving updates from doctors, making decisions about care, and managing information flow to family members. You are extremely anxious.',
            agent: 'Provide emotional support, help organize medical information, and assist with communication between family and medical team.'
        },
        turns: 12,
        department: 'critical_care',
        stage: 'critical',
        specialization: 'intensive_care',
        setting: 'inpatient_icu'
    },
    
    ipd_medication_adjustment: {
        name: '🏥 IPD Medication Adjustment - Monitoring',
        description: 'Patient admitted for medication adjustment and monitoring',
        category: 'hospital_ipd',
        complexity: 3,
        users: [
            { role: 'patient', personaKey: 'medication_nonadherent' },
            { role: 'caregiver', personaKey: 'engaged_caregiver' }
        ],
        instructions: {
            patient: 'You have been admitted to the hospital for medication adjustment. You have a history of non-adherence and want to understand why you are here.',
            caregiver: 'You are supporting the patient during their hospital stay. You want to ensure they understand the importance of medication compliance.',
            agent: 'Help explain the medication adjustment process, support adherence, and prepare for discharge planning.'
        },
        turns: 8,
        department: 'internal_medicine',
        stage: 'treatment_adjustment',
        specialization: 'internal_medicine',
        setting: 'inpatient'
    },
    
    ipd_chronic_disease_exacerbation: {
        name: '🏥 IPD Chronic Disease Exacerbation',
        description: 'Patient admitted due to chronic disease flare-up (e.g., COPD, heart failure)',
        category: 'hospital_ipd',
        complexity: 4,
        users: [
            { role: 'patient', personaKey: 'denial_prone' },
            { role: 'caregiver', personaKey: 'burned_out_caregiver' }
        ],
        instructions: {
            patient: 'You have been admitted to the hospital due to a flare-up of your chronic condition. You are minimizing the severity and want to go home quickly.',
            caregiver: 'You are exhausted from managing the patient\'s chronic condition. This hospitalization is adding stress and you need support.',
            agent: 'Help manage the hospitalization, address patient denial, and support caregiver during this stressful period.'
        },
        turns: 10,
        department: 'internal_medicine',
        stage: 'exacerbation',
        specialization: 'internal_medicine',
        setting: 'inpatient'
    },
    
    ipd_pediatrics_pneumonia: {
        name: '🏥 IPD Pediatrics - Child with Pneumonia',
        description: 'Child admitted with pneumonia, parent managing care and anxiety',
        category: 'hospital_ipd',
        complexity: 4,
        users: [
            { role: 'caregiver', personaKey: 'helicopter_caregiver' }
        ],
        instructions: {
            caregiver: 'Your child has been admitted to the hospital with pneumonia. You are staying with them, extremely worried, and want to understand every aspect of their care.',
            agent: 'Provide emotional support, help understand treatment plans, and assist with communication with pediatric medical team.'
        },
        turns: 10,
        department: 'pediatrics',
        stage: 'acute_illness',
        specialization: 'pediatrics',
        setting: 'inpatient'
    },
    
    ipd_discharge_planning: {
        name: '🏥 IPD Discharge Planning',
        description: 'Patient preparing for discharge, managing transition to home care',
        category: 'hospital_ipd',
        complexity: 4,
        users: [
            { role: 'patient', personaKey: 'elderly_cognitive' },
            { role: 'caregiver', personaKey: 'engaged_caregiver' }
        ],
        instructions: {
            patient: 'You are preparing to be discharged from the hospital. You are confused about medications, follow-up appointments, and home care instructions.',
            caregiver: 'You are preparing to take the patient home. You want to ensure you understand all discharge instructions, medications, and follow-up care.',
            agent: 'Help organize discharge information, clarify medication schedules, and prepare for transition to home care.'
        },
        turns: 10,
        department: 'general',
        stage: 'discharge',
        specialization: 'general_medicine',
        setting: 'inpatient_discharge'
    }
};

