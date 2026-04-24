use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex},
};

use crate::{DisplayProfile, IconDefinition, SchedulerState};

#[derive(Clone)]
pub struct AppState {
    pub(crate) icons: Arc<Vec<IconDefinition>>,
    pub(crate) http: reqwest::Client,
    pub(crate) data_dir: PathBuf,
    pub(crate) display_profiles: Arc<Vec<DisplayProfile>>,
    pub(crate) publish_hashes: Arc<Mutex<HashMap<String, String>>>,
    pub(crate) assignment_states: Arc<Mutex<HashMap<String, SchedulerState>>>,
}
